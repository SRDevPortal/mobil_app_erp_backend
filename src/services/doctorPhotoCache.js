// Short-lived, bounded cache of doctor directory photos (never patient images).
// Failed requests are not retained; concurrent callers share the same download.
function createDoctorPhotoCache({ ttlMs = 300000, maxBytes = 32 * 1024 * 1024, now = Date.now } = {}) {
  const entries = new Map();
  const pending = new Map();
  let bytes = 0;
  function remove(key) {
    bytes -= entries.get(key).body.length;
    entries.delete(key);
  }
  return {
    async get(key, fetchPhoto) {
      for (const [id, entry] of entries) {
        if (entry.expiresAt <= now()) remove(id);
      }
      if (entries.has(key)) return entries.get(key);
      if (pending.has(key)) return pending.get(key);
      const request = Promise.resolve().then(fetchPhoto).then((photo) => {
        if (photo.body.length <= maxBytes) {
          while (bytes + photo.body.length > maxBytes && entries.size) {
            remove(entries.keys().next().value);
          }
          entries.set(key, { ...photo, expiresAt: now() + ttlMs });
          bytes += photo.body.length;
        }
        return photo;
      }).finally(() => pending.delete(key));
      pending.set(key, request);
      return request;
    },
  };
}

module.exports = { createDoctorPhotoCache };
