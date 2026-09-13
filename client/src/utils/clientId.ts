const KEY = "syncspace.clientId";

export function getOrCreateClientId(): string {
  let id = localStorage.getItem(KEY);
  if (!id || !/^[a-zA-Z0-9_-]{8,64}$/.test(id)) {
    id = genClientId();
    localStorage.setItem(KEY, id);
  }
  return id;
}

function genClientId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID().replace(/-/g, "");
  }
  return (
    "c" + Math.random().toString(36).slice(2, 12) + Date.now().toString(36)
  );
}
