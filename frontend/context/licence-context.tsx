"use client";

import {
  createContext,
  useContext,
  type ReactNode,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { getLicenceManifest, DEFAULT_MANIFEST, type LicenceManifest } from "@/lib/api/licence";

interface LicenceContextValue {
  manifest: LicenceManifest;
  isLoading: boolean;
  isModuleEnabled: (module: string) => boolean;
  isMenuItemEnabled: (key: string) => boolean;
  isFeatureEnabled: (feature: keyof LicenceManifest["features"]) => boolean;
}

const LicenceContext = createContext<LicenceContextValue>({
  manifest: DEFAULT_MANIFEST,
  isLoading: true,
  isModuleEnabled: () => true,
  isMenuItemEnabled: () => true,
  isFeatureEnabled: () => true,
});

export function LicenceProvider({ children }: { children: ReactNode }) {
  const { data: manifest = DEFAULT_MANIFEST, isLoading } = useQuery({
    queryKey: ["licence-manifest"],
    queryFn: getLicenceManifest,
    staleTime: 5 * 60 * 1000,       // consider stale after 5 min
    refetchInterval: 6 * 60 * 60 * 1000, // refresh every 6 hours
    retry: false,
  });

  const isModuleEnabled = (module: string) => {
    if (!manifest.valid && manifest.valid !== null) return false;
    const modules = manifest.enabled_modules;
    return modules.includes("*") || modules.includes(module);
  };

  const isMenuItemEnabled = (key: string) => {
    const items = manifest.enabled_menu_items;
    // If checking failed or not yet loaded, allow all
    if (!items || items.length === 0 || manifest.valid === null) return true;
    return items.includes("*") || items.includes(key);
  };

  const isFeatureEnabled = (feature: keyof LicenceManifest["features"]) => {
    if (manifest.valid === null) return true; // still loading — don't gate
    return manifest.features[feature] === true;
  };

  return (
    <LicenceContext.Provider value={{ manifest, isLoading, isModuleEnabled, isMenuItemEnabled, isFeatureEnabled }}>
      {children}
    </LicenceContext.Provider>
  );
}

export function useLicence(): LicenceContextValue {
  return useContext(LicenceContext);
}
