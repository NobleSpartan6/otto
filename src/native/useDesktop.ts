import { useEffect, useRef, useState, type SetStateAction } from "react";
import {
  errorMessage,
  nativeAPI,
  type DesktopApp,
  type OttoConfig,
  type Permissions,
} from "../api";

export function useDesktop() {
  const [config, setConfigValue] = useState<OttoConfig | null>(null);
  const [apps, setApps] = useState<DesktopApp[]>([]);
  const [permissions, setPermissions] = useState<Permissions | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [appsLoading, setAppsLoading] = useState(true);
  const [permissionLoading, setPermissionLoading] = useState(false);
  const [appsError, setAppsError] = useState("");
  const [configError, setConfigError] = useState("");
  const mounted = useRef(true);
  const configGeneration = useRef(0);
  const appsGeneration = useRef(0);
  const permissionsGeneration = useRef(0);
  const permissionPending = useRef(false);

  useEffect(() => {
    mounted.current = true;
    void refreshSettings();
    void refreshApps();
    return () => {
      mounted.current = false;
      configGeneration.current++;
      appsGeneration.current++;
      permissionsGeneration.current++;
      permissionPending.current = false;
    };
  }, []);

  // A provider save is newer than every settings read already in flight.
  function setConfig(next: SetStateAction<OttoConfig | null>) {
    if (!mounted.current) return;
    configGeneration.current++;
    setConfigValue(next);
    setConfigError("");
    setConfigLoading(false);
  }

  async function refreshApps() {
    const generation = ++appsGeneration.current;
    const permissionsAtStart = permissionsGeneration.current;
    setAppsLoading(true);
    setAppsError("");
    try {
      const next = await nativeAPI().apps();
      if (!mounted.current || generation !== appsGeneration.current) return;
      setApps(next.apps);
      // App discovery may have captured permissions before a grant completed.
      if (
        !permissionPending.current &&
        permissionsAtStart === permissionsGeneration.current
      )
        setPermissions(next.permissions);
      return next;
    } catch (cause) {
      if (mounted.current && generation === appsGeneration.current)
        setAppsError(
          errorMessage(cause, "Otto could not refresh your open apps."),
        );
    } finally {
      if (mounted.current && generation === appsGeneration.current)
        setAppsLoading(false);
    }
  }

  async function refreshSettings() {
    const generation = ++configGeneration.current;
    setConfigLoading(true);
    setConfigError("");
    try {
      const next = await nativeAPI().config();
      if (mounted.current && generation === configGeneration.current)
        setConfigValue(next);
    } catch (cause) {
      if (mounted.current && generation === configGeneration.current)
        setConfigError(
          errorMessage(cause, "Otto could not read its settings."),
        );
    } finally {
      if (mounted.current && generation === configGeneration.current)
        setConfigLoading(false);
    }
  }

  async function retryRuntime() {
    await Promise.allSettled([refreshSettings(), refreshApps()]);
  }

  async function requestPermission(kind: "accessibility" | "screenCapture") {
    const generation = ++permissionsGeneration.current;
    permissionPending.current = true;
    setAppsError("");
    setPermissionLoading(true);
    try {
      const next = await nativeAPI().permissions(kind);
      if (mounted.current && generation === permissionsGeneration.current)
        setPermissions(next);
    } catch (cause) {
      if (mounted.current && generation === permissionsGeneration.current)
        setAppsError(
          errorMessage(cause, "Otto could not open system permissions."),
        );
    } finally {
      if (mounted.current && generation === permissionsGeneration.current) {
        // Also invalidate discovery started while the system prompt was open.
        permissionsGeneration.current++;
        permissionPending.current = false;
        setPermissionLoading(false);
      }
    }
  }

  const loading = configLoading || appsLoading || permissionLoading;
  return {
    config,
    setConfig,
    apps,
    permissions,
    loading,
    appsError,
    configError,
    refreshApps,
    refreshSettings,
    retryRuntime,
    requestPermission,
  };
}
