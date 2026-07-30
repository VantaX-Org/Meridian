"use client";

import { Server, Cloud, Plug, Trash2, RefreshCw, Loader2, MoreVertical } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { relativeTime, formatModuleName } from "@/lib/format";
import type { SAPSystemExtended, HealthStatus } from "@/types/api";

const ENV_COLORS: Record<string, string> = {
  PRD: "bg-destructive/10 text-destructive border-destructive/20",
  QAS: "bg-[#E76500]/10 text-[#E76500] border-[#E76500]/20",
  DEV: "bg-[#256F3A]/10 text-[#256F3A] border-[#256F3A]/20",
};

const TYPE_LABELS: Record<string, string> = {
  ecc: "ECC",
  s4hana_onprem: "S/4HANA On-Prem",
  s4hana_cloud: "S/4HANA Cloud",
  successfactors: "SuccessFactors",
  concur: "Concur",
  ariba: "Ariba",
  ewm: "EWM",
};

const HEALTH_DOT: Record<HealthStatus, string> = {
  healthy: "bg-[#256F3A]",
  degraded: "bg-[#E76500]",
  unreachable: "bg-destructive",
  auth_failed: "bg-destructive",
  unknown: "bg-muted-foreground",
};

function TypeIcon({ type }: { type: string }) {
  const isCloud = ["s4hana_cloud", "successfactors", "concur", "ariba"].includes(type);
  const Icon = isCloud ? Cloud : Server;
  return (
    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/[0.65]">
      <Icon className="h-5 w-5 text-primary" />
    </div>
  );
}

interface SystemCardProps {
  system: SAPSystemExtended;
  moduleCount?: number;
  onTest?: () => void;
  onSync?: () => void;
  onDelete?: () => void;
  isTesting?: boolean;
  isSyncing?: boolean;
}

export function SystemCard({
  system,
  moduleCount,
  onTest,
  onSync,
  onDelete,
  isTesting,
  isSyncing,
}: SystemCardProps) {
  const healthColor = HEALTH_DOT[system.health_status] ?? HEALTH_DOT.unknown;
  const healthLabel = system.health_status.replace("_", " ");

  return (
    <Card className="border-black/[0.08] bg-white/[0.70]">
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <TypeIcon type={system.system_type} />
            <div>
              <h3 className="font-semibold text-foreground">{system.name}</h3>
              <p className="text-xs text-muted-foreground">
                {system.host ?? system.base_url ?? "No endpoint"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-mono">
              {TYPE_LABELS[system.system_type] ?? system.system_type}
            </Badge>
            <Badge variant="outline" className={ENV_COLORS[system.environment] ?? ""}>
              {system.environment}
            </Badge>
          </div>
        </div>

        {system.description && (
          <p className="mt-2 text-sm text-muted-foreground line-clamp-2">{system.description}</p>
        )}

        {/* Health status + module count */}
        <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${healthColor}`} />
            <span className="capitalize">{healthLabel}</span>
          </span>
          {moduleCount !== undefined && (
            <span>{moduleCount} module{moduleCount !== 1 ? "s" : ""}</span>
          )}
        </div>

        {/* Last sync */}
        <div className="mt-2 text-xs text-muted-foreground">
          {system.last_health_check ? (
            <span>Last checked: {relativeTime(system.last_health_check)}</span>
          ) : (
            <span>Never checked</span>
          )}
        </div>

        {/* Actions */}
        <div className="mt-4 flex gap-2">
          {onTest && (
            <Button
              variant="outline"
              size="sm"
              onClick={onTest}
              disabled={isTesting}
              className="gap-1 text-xs border-black/[0.08] text-foreground"
            >
              {isTesting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plug className="h-3 w-3" />}
              Test
            </Button>
          )}
          {onSync && (
            <Button
              variant="outline"
              size="sm"
              onClick={onSync}
              disabled={isSyncing}
              className="gap-1 text-xs border-black/[0.08] text-foreground"
            >
              {isSyncing ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              Sync
            </Button>
          )}
          {onDelete && (
            <Button
              variant="outline"
              size="sm"
              onClick={onDelete}
              className="gap-1 text-xs border-destructive/20 text-destructive hover:bg-destructive/5 ml-auto"
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
