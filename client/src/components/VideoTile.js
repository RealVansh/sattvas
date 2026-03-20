import { useEffect, useRef } from 'react';

function VideoTile({ stream, label, muted = false }) {
  const videoRef = useRef(null);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <article className="video-tile">
      <video ref={videoRef} autoPlay playsInline muted={muted} />
      <p>{label}</p>
    </article>
  );
}

export default VideoTile;