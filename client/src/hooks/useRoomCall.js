import { useCallback, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';

const SIGNALING_SERVER_URL =
  process.env.REACT_APP_SIGNALING_URL ||
  (window.location.hostname === 'localhost' ? 'http://localhost:4000' : window.location.origin);
const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

function useRoomCall(roomId, userName) {
  const [localStream, setLocalStream] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [error, setError] = useState('');
  const [selfId, setSelfId] = useState('');
  const [hostId, setHostId] = useState('');
  const [adminNotice, setAdminNotice] = useState('');
  const [privateAudioTarget, setPrivateAudioTargetState] = useState('');
  const [globalPinnedId, setGlobalPinnedId] = useState(null);

  const socketRef = useRef(null);
  const localStreamRef = useRef(null);
  const peerConnectionsRef = useRef(new Map());
  const audioSendersRef = useRef(new Map());
  const privateAudioTargetRef = useRef('');
  const adminNoticeTimerRef = useRef(null);
  const silentTrackRef = useRef(null);
  const peerNamesRef = useRef(new Map());

  const getSilentTrack = useCallback(() => {
    if (!silentTrackRef.current) {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const dest = audioContext.createMediaStreamDestination();
      silentTrackRef.current = dest.stream.getAudioTracks()[0];
    }
    return silentTrackRef.current;
  }, []);

  const isHost = Boolean(selfId) && selfId === hostId;

  const routePrivateAudio = useCallback(async (targetPeerId) => {
    const stream = localStreamRef.current;
    const audioTrack = stream?.getAudioTracks()?.[0] || null;
    const silentTrack = getSilentTrack();

    const updates = [];
    audioSendersRef.current.forEach((sender, peerId) => {
      if (!sender) {
        return;
      }

      if (!audioTrack) {
        updates.push(sender.replaceTrack(silentTrack));
        return;
      }

      if (!targetPeerId) {
        updates.push(sender.replaceTrack(audioTrack));
        return;
      }

      updates.push(sender.replaceTrack(peerId === targetPeerId ? audioTrack : silentTrack));
    });

    await Promise.allSettled(updates);
  }, [getSilentTrack]);

  const setPrivateAudioTarget = useCallback(
    async (targetPeerId) => {
      privateAudioTargetRef.current = targetPeerId || '';
      setPrivateAudioTargetState(targetPeerId || '');
      await routePrivateAudio(targetPeerId || '');
    },
    [routePrivateAudio]
  );

  const sendAdminCommand = useCallback(
    (target, type, value) => {
      if (!isHost || !target || !type) {
        return;
      }

      const socket = socketRef.current;
      if (!socket) {
        return;
      }

      socket.emit('admin-command', {
        target,
        type,
        value
      });
    },
    [isHost]
  );

  const sendAdminBroadcast = useCallback(
    (type, value) => {
      if (!isHost || !type) {
        return;
      }

      const socket = socketRef.current;
      if (!socket) {
        return;
      }

      socket.emit('admin-broadcast', {
        type,
        value
      });
    },
    [isHost]
  );

  useEffect(() => {
    if (!roomId) {
      setParticipants([]);
      setLocalStream(null);
      setError('');
      setSelfId('');
      setHostId('');
      setAdminNotice('');
      setPrivateAudioTargetState('');
      setGlobalPinnedId(null);
      privateAudioTargetRef.current = '';
      peerNamesRef.current.clear();
      return undefined;
    }

    let isCancelled = false;
    const peerConnections = peerConnectionsRef.current;
    const audioSenders = audioSendersRef.current;

    const addOrUpdateParticipant = (id, stream) => {
      const name = peerNamesRef.current.get(id) || id.slice(0, 6);
      setParticipants((prev) => {
        const index = prev.findIndex((participant) => participant.id === id);
        if (index === -1) {
          return [...prev, { id, name, stream }];
        }

        const next = [...prev];
        next[index] = { id, name, stream };
        return next;
      });
    };

    const removeParticipant = (id) => {
      setParticipants((prev) => prev.filter((participant) => participant.id !== id));
    };

    const closePeerConnection = (peerId) => {
      const peer = peerConnectionsRef.current.get(peerId);
      if (peer) {
        peer.onicecandidate = null;
        peer.ontrack = null;
        peer.close();
      }
      peerConnectionsRef.current.delete(peerId);
      audioSendersRef.current.delete(peerId);
      peerNamesRef.current.delete(peerId);
    };

    const createPeerConnection = (peerId, socket) => {
      if (peerConnectionsRef.current.has(peerId)) {
        return peerConnectionsRef.current.get(peerId);
      }

      const peerConnection = new RTCPeerConnection({
        iceServers: ICE_SERVERS
      });

      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => {
          const sender = peerConnection.addTrack(track, localStreamRef.current);
          if (track.kind === 'audio') {
            audioSendersRef.current.set(peerId, sender);
          }
        });
      }

      routePrivateAudio(privateAudioTargetRef.current);

      peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit('webrtc-ice-candidate', {
            target: peerId,
            candidate: event.candidate
          });
        }
      };

      peerConnection.ontrack = (event) => {
        const [stream] = event.streams;
        if (stream) {
          addOrUpdateParticipant(peerId, stream);
        }
      };

      peerConnection.onconnectionstatechange = () => {
        if (['failed', 'closed', 'disconnected'].includes(peerConnection.connectionState)) {
          closePeerConnection(peerId);
          removeParticipant(peerId);
        }
      };

      peerConnectionsRef.current.set(peerId, peerConnection);
      return peerConnection;
    };

    const createOfferToPeer = async (peerId, socket) => {
      const peerConnection = createPeerConnection(peerId, socket);
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);

      socket.emit('webrtc-offer', {
        target: peerId,
        sdp: offer
      });
    };

    const initialize = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true
        });

        if (isCancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        localStreamRef.current = stream;
        setLocalStream(stream);
        setIsAudioEnabled(stream.getAudioTracks().every((track) => track.enabled));
        setIsVideoEnabled(stream.getVideoTracks().every((track) => track.enabled));
        setError('');

        const socket = io(SIGNALING_SERVER_URL, {
          transports: ['websocket']
        });

        socketRef.current = socket;

        socket.on('connect', () => {
          socket.emit('join-room', { roomId, userName });
        });

        socket.on('room-full', () => {
          setError('Room is full. Please use another room ID.');
        });

        socket.on('room-error', (payload) => {
          setError(payload?.message || 'Unable to join room.');
        });

        socket.on('existing-users', async ({ users, hostId: nextHostId, selfId: socketSelfId, pinnedSpeakerId }) => {
          setHostId(nextHostId || '');
          setSelfId(socketSelfId || socket.id);
          
          if (pinnedSpeakerId) {
            setGlobalPinnedId(pinnedSpeakerId);
          }

          for (const peer of users) {
             peerNamesRef.current.set(peer.id, peer.name);
          }

          for (const peer of users) {
            await createOfferToPeer(peer.id, socket);
          }
        });

        socket.on('host-changed', ({ hostId: nextHostId }) => {
          setHostId(nextHostId || '');
        });

        socket.on('webrtc-offer', async ({ from, sdp }) => {
          const peerConnection = createPeerConnection(from, socket);
          await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));

          const answer = await peerConnection.createAnswer();
          await peerConnection.setLocalDescription(answer);

          socket.emit('webrtc-answer', {
            target: from,
            sdp: answer
          });
        });

        socket.on('webrtc-answer', async ({ from, sdp }) => {
          const peerConnection = peerConnectionsRef.current.get(from);
          if (!peerConnection) {
            return;
          }

          await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
        });

        socket.on('webrtc-ice-candidate', async ({ from, candidate }) => {
          if (!candidate) {
            return;
          }

          const peerConnection = createPeerConnection(from, socket);
          try {
            await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
          } catch (iceError) {
            console.error('Error adding ICE candidate:', iceError);
          }
        });

        socket.on('user-joined', ({ socketId, name, hostId }) => {
          peerNamesRef.current.set(socketId, name);
        });

        socket.on('user-left', ({ socketId }) => {
          if (privateAudioTargetRef.current === socketId) {
            setPrivateAudioTarget('');
          }
          closePeerConnection(socketId);
          removeParticipant(socketId);
        });

        socket.on('admin-command', ({ type, value }) => {
          const stream = localStreamRef.current;
          if (!stream) {
            return;
          }

          if (type === 'set-audio-enabled' && typeof value === 'boolean') {
            stream.getAudioTracks().forEach((track) => {
              track.enabled = value;
            });
            setIsAudioEnabled(value);
            setAdminNotice(value ? 'Host unmuted your mic.' : 'Host muted your mic.');
          }

          if (type === 'set-video-enabled' && typeof value === 'boolean') {
            stream.getVideoTracks().forEach((track) => {
              track.enabled = value;
            });
            setIsVideoEnabled(value);
            setAdminNotice(value ? 'Host turned your camera on.' : 'Host turned your camera off.');
          }

          if (type === 'set-whisper') {
            setPrivateAudioTarget(value || '');
            setAdminNotice(value ? 'Host started a private whisper with you.' : 'Private whisper ended.');
          }

          if (adminNoticeTimerRef.current) {
            clearTimeout(adminNoticeTimerRef.current);
          }

          adminNoticeTimerRef.current = setTimeout(() => {
            setAdminNotice('');
          }, 2200);
        });

        socket.on('admin-broadcast', ({ type, value }) => {
          if (type === 'set-pinned') {
            setGlobalPinnedId(value);
          }
        });
      } catch (mediaError) {
        console.error('Error starting local media:', mediaError);
        setError('Unable to access camera/microphone. Check browser permissions.');
      }
    };

    initialize();

    return () => {
      isCancelled = true;

      const socket = socketRef.current;
      if (socket) {
        socket.emit('leave-room');
        socket.removeAllListeners();
        socket.disconnect();
      }
      socketRef.current = null;

      peerConnections.forEach((peerConnection) => {
        peerConnection.ontrack = null;
        peerConnection.onicecandidate = null;
        peerConnection.close();
      });
      peerConnections.clear();
      audioSenders.clear();
      peerNamesRef.current.clear();

      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => track.stop());
      }
      localStreamRef.current = null;

      if (adminNoticeTimerRef.current) {
        clearTimeout(adminNoticeTimerRef.current);
      }
      adminNoticeTimerRef.current = null;

      setParticipants([]);
      setLocalStream(null);
      setSelfId('');
      setHostId('');
      setAdminNotice('');
      setPrivateAudioTargetState('');
      setGlobalPinnedId(null);
      privateAudioTargetRef.current = '';
    };
  }, [roomId, userName, routePrivateAudio, setPrivateAudioTarget]);

  const toggleAudio = () => {
    const stream = localStreamRef.current;
    if (!stream) {
      return;
    }

    const enabled = !isAudioEnabled;
    stream.getAudioTracks().forEach((track) => {
      track.enabled = enabled;
    });
    setIsAudioEnabled(enabled);

    if (enabled) {
      routePrivateAudio(privateAudioTargetRef.current);
    }
  };

  const toggleVideo = () => {
    const stream = localStreamRef.current;
    if (!stream) {
      return;
    }

    const enabled = !isVideoEnabled;
    stream.getVideoTracks().forEach((track) => {
      track.enabled = enabled;
    });
    setIsVideoEnabled(enabled);
  };

  return {
    localStream,
    participants,
    isAudioEnabled,
    isVideoEnabled,
    selfId,
    hostId,
    isHost,
    adminNotice,
    privateAudioTarget,
    globalPinnedId,
    toggleAudio,
    toggleVideo,
    sendAdminCommand,
    sendAdminBroadcast,
    setPrivateAudioTarget,
    error
  };
}

export default useRoomCall;