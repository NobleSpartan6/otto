import { useEffect, useRef, useState, type SetStateAction } from "react";
import {
  errorMessage,
  nativeAPI,
  type DesktopApp,
  type OttoConfig,
  type Permissions,
} from "../api";

type AppDiscovery = { apps: DesktopApp[]; permissions: Permissions };
type PermissionKind = "accessibility" | "screenCapture";

export function useDesktop() {
  const [config, setConfigValue] = useState<OttoConfig | null>(null);
  const [apps, setApps] = useState<DesktopApp[]>([]);
  const [permissions, setPermissions] = useState<Permissions | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [appsLoading, setAppsLoading] = useState(true);
  const [permissionLoading, setPermissionLoading] = useState(false);
  const [waitingPermission, setWaitingPermission] =
    useState<PermissionKind | null>(null);
  const [appsError, setAppsError] = useState("");
  const [configError, setConfigError] = useState("");
  const mounted = useRef(true);
  const configGeneration = useRef(0);
  const appsGeneration = useRef(0);
  const permissionsGeneration = useRef(0);
  const permissionPending = useRef(false);
  const discovery = useRef<Promise<AppDiscovery | undefined> | null>(null);
  const permissionWatch = useRef<{
    kind: PermissionKind;
    deadline: number;
    timer?: ReturnType<typeof setTimeout>;
  } | null>(null);

  useEffect(() => {
    mounted.current = true;
    void refreshSettings();
    void refreshApps();
    const refreshOnReturn = () => {
      if (document.visibilityState === "visible") void refreshApps(true);
    };
    window.addEventListener("focus", refreshOnReturn);
    document.addEventListener("visibilitychange", refreshOnReturn);
    return () => {
      mounted.current = false;
      configGeneration.current++;
      appsGeneration.current++;
      permissionsGeneration.current++;
      permissionPending.current = false;
      discovery.current = null;
      clearTimeout(permissionWatch.current?.timer);
      permissionWatch.current = null;
      window.removeEventListener("focus", refreshOnReturn);
      document.removeEventListener("visibilitychange", refreshOnReturn);
    };
  }, []);

  function setConfig(next: SetStateAction<OttoConfig | null>) {
    if (!mounted.current) return;
    configGeneration.current++;
    setConfigValue(next);
    setConfigError("");
    setConfigLoading(false);
  }

  function finishPermissionWatch() {
    clearTimeout(permissionWatch.current?.timer);
    permissionWatch.current = null;
    if (mounted.current) setWaitingPermission(null);
  }

  function refreshApps(quiet = false): Promise<AppDiscovery | undefined> {
    // Returning from System Settings often emits focus and visibility together.
    // Share their read instead of superseding and starving one another.
    if (discovery.current) return discovery.current;
    const generation = ++appsGeneration.current;
    const permissionsAtStart = permissionsGeneration.current;
    if (!quiet) {
      setAppsLoading(true);
      setAppsError("");
    }
    const request = (async () => {
      try {
        const next = await nativeAPI().apps();
        if (!mounted.current || generation !== appsGeneration.current) return;
        setApps(next.apps);
        setAppsError("");
        if (
          !permissionPending.current &&
          permissionsAtStart === permissionsGeneration.current
        ) {
          setPermissions(next.permissions);
          const watch = permissionWatch.current;
          if (watch && next.permissions[watch.kind]) finishPermissionWatch();
        }
        return next;
      } catch (cause) {
        if (!quiet && mounted.current && generation === appsGeneration.current)
          setAppsError(
            errorMessage(cause, "Otto could not refresh your open apps."),
          );
      } finally {
        if (mounted.current && generation === appsGeneration.current)
          setAppsLoading(false);
      }
    })();
    discovery.current = request;
    void request.finally(() => {
      if (discovery.current === request) discovery.current = null;
    });
    return request;
  }

  function watchPermission(kind: PermissionKind) {
    finishPermissionWatch();
    const watch = {
      kind,
      deadline: Date.now() + 60_000,
      timer: undefined as ReturnType<typeof setTimeout> | undefined,
    };
    permissionWatch.current = watch;
    setWaitingPermission(kind);
    const check = async () => {
      if (!mounted.current || permissionWatch.current !== watch) return;
      if (Date.now() >= watch.deadline) {
        finishPermissionWatch();
        return;
      }
      await refreshApps(true);
      if (mounted.current && permissionWatch.current === watch)
        watch.timer = setTimeout(check, 1500);
    };
    watch.timer = setTimeout(check, 1500);
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

  async function requestPermission(kind: PermissionKind) {
    if (permissionPending.current) return;
    finishPermissionWatch();
    const generation = ++permissionsGeneration.current;
    permissionPending.current = true;
    setAppsError("");
    setPermissionLoading(true);
    let granted = false;
    try {
      const next = await nativeAPI().permissions(kind);
      if (mounted.current && generation === permissionsGeneration.current) {
        setPermissions(next);
        granted = next[kind];
      }
    } catch (cause) {
      if (mounted.current && generation === permissionsGeneration.current)
        setAppsError(
          errorMessage(
            cause,
            "Otto could not open system permissions. Open System Settings and allow this app, then return to Otto.",
          ),
        );
    } finally {
      if (mounted.current && generation === permissionsGeneration.current) {
        permissionsGeneration.current++;
        permissionPending.current = false;
        setPermissionLoading(false);
        if (!granted) watchPermission(kind);
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
    waitingPermission,
    appsError,
    configError,
    refreshApps,
    refreshSettings,
    retryRuntime,
    requestPermission,
  };
}
