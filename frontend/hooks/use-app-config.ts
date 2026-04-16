"use client";

import { useEffect, useState } from "react";

interface AppConfig {
  authMode: "local" | "clerk";
}

const defaultConfig: AppConfig = { authMode: "local" };
let cachedConfig: AppConfig | null = null;

export function useAppConfig() {
  const [config, setConfig] = useState<AppConfig>(cachedConfig || defaultConfig);
  const [isLoading, setIsLoading] = useState(!cachedConfig);

  useEffect(() => {
    if (cachedConfig) return;

    fetch("/api/config")
      .then((res) => res.json())
      .then((data) => {
        cachedConfig = data;
        setConfig(data);
      })
      .catch(() => {
        // Default to local on error
        cachedConfig = defaultConfig;
      })
      .finally(() => setIsLoading(false));
  }, []);

  return { config, isLoading };
}
