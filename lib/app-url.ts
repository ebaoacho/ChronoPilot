export function resolveAppOrigin(currentOrigin: string, configuredUrl?: string) {
  const current = new URL(currentOrigin);
  const currentIsLocal = current.hostname === "localhost" || current.hostname === "127.0.0.1";
  if (currentIsLocal) return current.origin;

  if (configuredUrl) {
    try {
      const configured = new URL(configuredUrl);
      const configuredIsLocal = configured.hostname === "localhost" || configured.hostname === "127.0.0.1";
      if (!configuredIsLocal && configured.protocol === "https:") return configured.origin;
    } catch {
      // A malformed deployment setting must not break sign-in.
    }
  }

  return current.origin;
}
