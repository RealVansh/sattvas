export function getRoomIdFromPath(pathname) {
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length === 2 && parts[0] === 'room') {
    return parts[1];
  }
  return '';
}

export function navigateToRoom(roomId) {
  window.history.pushState({}, '', `/room/${roomId}`);
}

export function createRoomId() {
  return Math.random().toString(36).slice(2, 10);
}