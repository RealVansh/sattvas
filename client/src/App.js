import './App.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import VideoTile from './components/VideoTile';
import { createRoomId, getRoomIdFromPath, navigateToRoom } from './utils/room';
import useRoomCall from './hooks/useRoomCall';

function App() {
  const urlRoomId = useMemo(() => getRoomIdFromPath(window.location.pathname), []);
  const [roomInput, setRoomInput] = useState(urlRoomId || '');
  const [userName, setUserName] = useState(() => localStorage.getItem('userName') || '');
  const [roomId, setRoomId] = useState('');
  const [controlsVisible, setControlsVisible] = useState(true);
  const [shareMessage, setShareMessage] = useState('');
  const [isJoinMode, setIsJoinMode] = useState(Boolean(urlRoomId));
  const [expandedAdminUser, setExpandedAdminUser] = useState(null);
  const [showParticipants, setShowParticipants] = useState(false);
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
    globalPinnedId,
    toggleAudio,
    toggleVideo,
    sendAdminCommand,
    sendAdminBroadcast,
    setPrivateAudioTarget,
    error
  } = useRoomCall(roomId, userName);

  const roomUrl = useMemo(() => `${window.location.origin}/room/${roomId}`, [roomId]);

  useEffect(() => {
    if (!roomId) {
      setControlsVisible(true);
      return undefined;
    }

    return () => {
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
          title: "Sattva's Synergy Class",
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

  const handleNameChange = (e) => {
    const val = e.target.value;
    setUserName(val);
    localStorage.setItem('userName', val);
  };

  const handleCreateRoom = () => {
    if (!userName.trim()) return;
    const newRoomId = createRoomId();
    navigateToRoom(newRoomId);
    setRoomId(newRoomId);
    setRoomInput('');
  };

  const handleJoinRoom = (event) => {
    event.preventDefault();
    const trimmed = roomInput.trim();

    if (!trimmed || !userName.trim()) {
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
          <img src="/logo.png" alt="Sattva Yoga Logo" className="lobby-logo" onError={(e) => e.target.style.display = 'none'} />
          <p className="subtitle">Sattva's Synergy</p>

          <div className="input-group">
            <label htmlFor="userName">Your Name</label>
            <input
              id="userName"
              type="text"
              value={userName}
              onChange={handleNameChange}
              placeholder="Enter your name to join"
              required
            />
          </div>

          {!isJoinMode ? (
            <div className="lobby-actions vertical-actions">
              <button type="button" onClick={handleCreateRoom} disabled={!userName.trim()}>
                Start a New Class
              </button>
              <button type="button" className="secondary-button" onClick={() => setIsJoinMode(true)}>
                Join Existing Class
              </button>
            </div>
          ) : (
            <form className="join-form" onSubmit={handleJoinRoom}>
              <div className="input-group">
                <label htmlFor="roomId">Class ID / Link</label>
                <input
                  id="roomId"
                  type="text"
                  value={roomInput}
                  onChange={(event) => setRoomInput(event.target.value)}
                  placeholder="Enter Class ID"
                  required
                />
              </div>
              <div className="lobby-actions vertical-actions">
                <button type="submit" disabled={!userName.trim() || !roomInput.trim()}>
                  Enter Class
                </button>
                {!urlRoomId && (
                  <button type="button" className="secondary-button" onClick={() => setIsJoinMode(false)}>
                    Back
                  </button>
                )}
              </div>
            </form>
          )}
        </div>
      </main>
    );
  }

  const handleBackgroundTap = (e) => {
    // Only toggle if they click the background/grid directly, not the buttons
    if (e.target.tagName !== 'BUTTON' && !e.target.closest('.admin-panel')) {
      setControlsVisible((v) => !v);
    }
  };

  const allParticipants = [
    localStream ? { id: selfId, name: 'You', stream: localStream, isLocal: true } : null,
    ...participants
  ].filter(Boolean);

  const activePinId = globalPinnedId;
  const displayPinId = activePinId === selfId ? null : activePinId;
  const pinnedUser = displayPinId ? allParticipants.find(p => p.id === displayPinId) : null;
  const unpinnedUsers = displayPinId ? allParticipants.filter(p => p.id !== displayPinId) : allParticipants;

  return (
    <main
      className="room-page immersive"
      onClick={handleBackgroundTap}
      role="presentation"
    >
      <section className={`video-grid ${displayPinId ? 'has-spotlight' : 'fullscreen-grid'}`}>
        {displayPinId && pinnedUser ? (
          <div className="spotlight-main">
            <VideoTile 
              stream={pinnedUser.stream} 
              label={pinnedUser.name} 
              muted={pinnedUser.isLocal} 
              isLocal={pinnedUser.isLocal}
              isPinned={activePinId === pinnedUser.id}
              onPin={isHost ? () => sendAdminBroadcast('set-pinned', activePinId === pinnedUser.id ? null : pinnedUser.id) : undefined}
            />
          </div>
        ) : null}

        <div className={displayPinId ? 'spotlight-strip' : 'grid-inner'}>
          {unpinnedUsers.map((p) => (
            <VideoTile 
              key={p.id} 
              stream={p.stream} 
              label={p.name} 
              muted={p.isLocal} 
              isLocal={p.isLocal}
              isPinned={activePinId === p.id}
              onPin={isHost ? () => sendAdminBroadcast('set-pinned', activePinId === p.id ? null : p.id) : undefined}
            />
          ))}
        </div>
      </section>

      {error ? <p className="error floating-error">{error}</p> : null}
      {adminNotice ? <p className="admin-toast">{adminNotice}</p> : null}

      {isHost && showParticipants ? (
        <aside className={`admin-panel ${controlsVisible ? 'is-visible' : 'is-hidden'}`}>
          {participants.length === 0 ? <p className="admin-empty">No participants yet.</p> : null}

          {participants.map((participant) => {
            const isWhisperTarget = privateAudioTarget === participant.id;
            const isTargetPinned = globalPinnedId === participant.id;

            return (
              <div className="admin-row" key={participant.id}>
                <button 
                  type="button"
                  className="admin-row-header"
                  onClick={() => setExpandedAdminUser(prev => prev === participant.id ? null : participant.id)}
                >
                  <span>{participant.name || participant.id.slice(0, 6)}</span>
                  <span className="expand-icon">{expandedAdminUser === participant.id ? '▼' : '▶'}</span>
                </button>

                {expandedAdminUser === participant.id && (
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
                    <button
                      type="button"
                      className={isTargetPinned ? 'active-pin' : ''}
                      onClick={() => sendAdminBroadcast('set-pinned', isTargetPinned ? null : participant.id)}
                      title="Spotlight for Everyone"
                    >
                      {isTargetPinned ? 'Unspotlight' : 'Spotlight'}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </aside>
      ) : null}

      <section
        className={`controls floating-controls ${controlsVisible ? 'is-visible' : 'is-hidden'}`}
        aria-label="Media controls"
      >
        <button type="button" onClick={toggleAudio} title={isAudioEnabled ? "Mute Microphone" : "Unmute Microphone"} className="icon-btn">
          {isAudioEnabled ? '🎙️' : '🔇'}
        </button>
        <button type="button" onClick={toggleVideo} title={isVideoEnabled ? "Turn off Camera" : "Turn on Camera"} className="icon-btn">
          {isVideoEnabled ? '📹' : '📵'}
        </button>
        {isHost && (
          <button type="button" onClick={() => setShowParticipants(s => !s)} title="Host Controls & Participants" className="icon-btn">
            👥
          </button>
        )}
        {isHost && (
          <button type="button" onClick={shareRoom} title="Share Invite Link" className="icon-btn">
            🔗
          </button>
        )}
        {isHost && privateAudioTarget ? (
          <button type="button" className="icon-btn active-whisper-btn" onClick={() => {
            const target = privateAudioTarget;
            setPrivateAudioTarget('');
            sendAdminCommand(target, 'set-whisper', null);
          }} title="End Whisper Session">
            🤫
          </button>
        ) : null}
        <button type="button" className="danger icon-btn" onClick={leaveRoom} title="Leave Class">
          ☎️
        </button>
      </section>

      {shareMessage ? <p className="share-toast">{shareMessage}</p> : null}
    </main>
  );
}

export default App;
