import { useEffect, useRef } from 'react';

function VideoTile({ stream, label, muted = false, isLocal = false, isPinned = false, onPin = null }) {
  const videoRef = useRef(null);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <article className={`video-tile ${isPinned ? 'is-pinned' : ''}`}>
      <video className={isLocal ? 'mirrored' : ''} ref={videoRef} autoPlay playsInline muted={muted} />
      <div className="video-overlay">
        <p>{label}</p>
        {onPin && (
          <button 
            type="button" 
            className={`pin-button ${isPinned ? 'active-pin-btn' : ''}`} 
            onClick={(e) => { e.stopPropagation(); onPin(); }}
            title="Spotlight this video for the entire class"
          >
            {isPinned ? 'Remove Spotlight' : '📌 Spotlight'}
          </button>
        )}
      </div>
    </article>
  );
}

export default VideoTile;