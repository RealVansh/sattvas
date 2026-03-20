import './App.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import VideoTile from './components/VideoTile';
import { createRoomId, getRoomIdFromPath, navigateToRoom } from './utils/room';
import useRoomCall from './hooks/useRoomCall';

function App() {
  const [roomInput, setRoomInput] = useState('');
  const [roomId, setRoomId] = useState(() => getRoomIdFromPath(window.location.pathname));
  const [controlsVisible, setControlsVisible] = useState(true);
  const [shareMessage, setShareMessage] = useState('');
  const hideControlsTimerRef = useRef(null);
  const shareMessageTimerRef = useRef(null);

  const {
    localStream,
    participants,
    isAudioEnabled,
    isVideoEnabled,
    isHost,
    selfId,
    adminNotice,
    privateAudioTarget,
    toggleAudio,
    toggleVideo,
    sendAdminCommand,
    setPrivateAudioTarget,
    error
  } = useRoomCall(roomId);

  const participantCount = useMemo(() => participants.length + (localStream ? 1 : 0), [participants, localStream]);
  const roomUrl = useMemo(() => `${window.location.origin}/room/${roomId}`, [roomId]);

  const resetControlsTimer = () => {
    setControlsVisible(true);

    if (hideControlsTimerRef.current) {
      clearTimeout(hideControlsTimerRef.current);
    }

    hideControlsTimerRef.current = setTimeout(() => {
      setControlsVisible(false);
    }, 3500);
  };

  useEffect(() => {
    if (!roomId) {
      setControlsVisible(true);
      return undefined;
    }

    resetControlsTimer();

    return () => {
      if (hideControlsTimerRef.current) {
        clearTimeout(hideControlsTimerRef.current);
      }

      if (shareMessageTimerRef.current) {
        clearTimeout(shareMessageTimerRef.current);
      }
    };
  }, [roomId]);

  const setTemporaryShareMessage = (message) => {
    setShareMessage(message);

    if (shareMessageTimerRef.current) {
      clearTimeout(shareMessageTimerRef.current);
    }

    shareMessageTimerRef.current = setTimeout(() => {
      setShareMessage('');
    }, 2200);
  };

  const shareRoom = async () => {
    try {
      if (navigator.share) {
        await navigator.share({
          title: 'Join my video call',
          text: 'Join my room:',
          url: roomUrl
        });
        setTemporaryShareMessage('Room link shared.');
        return;
      }

      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(roomUrl);
        setTemporaryShareMessage('Room link copied.');
        return;
      }

      setTemporaryShareMessage('Copy this link: ' + roomUrl);
    } catch (shareError) {
      if (shareError?.name !== 'AbortError') {
        setTemporaryShareMessage('Unable to share link.');
      }
    }
  };

  const handleCreateRoom = () => {
    const newRoomId = createRoomId();
    navigateToRoom(newRoomId);
    setRoomId(newRoomId);
    setRoomInput('');
  };

  const handleJoinRoom = (event) => {
    event.preventDefault();
    const trimmed = roomInput.trim();

    if (!trimmed) {
      return;
    }

    navigateToRoom(trimmed);
    setRoomId(trimmed);
  };

  const leaveRoom = () => {
    window.history.pushState({}, '', '/');
    setRoomId('');
    setRoomInput('');
    setShareMessage('');
  };

  if (!roomId) {
    return (
      <main className="lobby">
        <div className="lobby-card">
          <h1>Sattva's Synergy</h1>
          <p>Create a room or join one by room ID.</p>

          <div className="lobby-actions">
            <button type="button" onClick={handleCreateRoom}>
              Create Room
            </button>
          </div>

          <form className="join-form" onSubmit={handleJoinRoom}>
            <input
              type="text"
              value={roomInput}
              onChange={(event) => setRoomInput(event.target.value)}
              placeholder="Enter room id"
              aria-label="Room ID"
            />
            <button type="submit">Join Room</button>
          </form>
        </div>
      </main>
    );
  }

  return (
    <main
      className="room-page immersive"
      onPointerDown={resetControlsTimer}
      onPointerMove={resetControlsTimer}
      onKeyDown={resetControlsTimer}
      role="presentation"
    >
      <section className="video-grid fullscreen-grid">
        {localStream ? <VideoTile stream={localStream} label="You" muted /> : null}

        {participants.map((participant) => (
          <VideoTile key={participant.id} stream={participant.stream} label={participant.id.slice(0, 6)} />
        ))}
      </section>

      {error ? <p className="error floating-error">{error}</p> : null}
      {adminNotice ? <p className="admin-toast">{adminNotice}</p> : null}

      <header className={`room-header floating-header ${controlsVisible ? 'is-visible' : 'is-hidden'}`}>
        <div>
          <h1>Room: {roomId}</h1>
          <p>
            {participantCount} participants • {isHost ? 'Host' : 'Participant'}
          </p>
        </div>
      </header>

      {isHost ? (
        <aside className={`admin-panel ${controlsVisible ? 'is-visible' : 'is-hidden'}`}>
          <h2>Host Controls</h2>
          <p className="admin-subtitle">You can moderate participants and start 1:1 whisper mode.</p>

          {participants.length === 0 ? <p className="admin-empty">No participants yet.</p> : null}

          {participants.map((participant) => {
            const isWhisperTarget = privateAudioTarget === participant.id;

            return (
              <div className="admin-row" key={participant.id}>
                <span>{participant.id.slice(0, 6)}</span>

                <div className="admin-row-actions">
                  <button
                    type="button"
                    onClick={() => sendAdminCommand(participant.id, 'set-audio-enabled', false)}
                  >
                    Mute
                  </button>
                  <button
                    type="button"
                    onClick={() => sendAdminCommand(participant.id, 'set-audio-enabled', true)}
                  >
                    Unmute
                  </button>
                  <button
                    type="button"
                    onClick={() => sendAdminCommand(participant.id, 'set-video-enabled', false)}
                  >
                    Cam Off
                  </button>
                  <button
                    type="button"
                    onClick={() => sendAdminCommand(participant.id, 'set-video-enabled', true)}
                  >
                    Cam On
                  </button>
                  <button
                    type="button"
                    className={isWhisperTarget ? 'active-whisper' : ''}
                    onClick={() => {
                      if (!isWhisperTarget && privateAudioTarget) {
                        sendAdminCommand(privateAudioTarget, 'set-whisper', null);
                      }
                      setPrivateAudioTarget(isWhisperTarget ? '' : participant.id);
                      sendAdminCommand(participant.id, 'set-whisper', isWhisperTarget ? null : selfId);
                    }}
                  >
                    {isWhisperTarget ? 'Stop Whisper' : 'Whisper'}
                  </button>
                </div>
              </div>
            );
          })}
        </aside>
      ) : null}

      <section
        className={`controls floating-controls ${controlsVisible ? 'is-visible' : 'is-hidden'}`}
        aria-label="Media controls"
      >
        <button type="button" onClick={toggleAudio}>
          {isAudioEnabled ? 'Mute' : 'Unmute'}
        </button>
        <button type="button" onClick={toggleVideo}>
          {isVideoEnabled ? 'Camera Off' : 'Camera On'}
        </button>
        <button type="button" onClick={shareRoom}>
          Share
        </button>
        {isHost && privateAudioTarget ? (
          <button type="button" onClick={() => {
            const target = privateAudioTarget;
            setPrivateAudioTarget('');
            sendAdminCommand(target, 'set-whisper', null);
          }}>
            End Whisper
          </button>
        ) : null}
        <button type="button" className="danger" onClick={leaveRoom}>
          Leave
        </button>
      </section>

      {shareMessage ? <p className="share-toast">{shareMessage}</p> : null}
    </main>
  );
}

export default App;
