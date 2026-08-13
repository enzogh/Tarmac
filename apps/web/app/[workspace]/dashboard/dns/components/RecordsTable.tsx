'use client';

import { useState } from 'react';
import { MapPin, Pencil, Trash2 } from 'lucide-react';
import { DnsRecordItem } from '@/lib/api';
import { Badge } from '@/components/ui';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { StatusIndicator } from './StatusIndicator';

export function RecordsTable({
  zoneId,
  records,
  busyKey,
  onEdit,
  onDelete,
}: {
  zoneId: string;
  records: DnsRecordItem[];
  busyKey: string | null;
  onEdit: (record: DnsRecordItem) => void;
  onDelete: (zoneId: string, recordId: string) => void;
}) {
  const [expandedValues, setExpandedValues] = useState<Set<string>>(new Set());
  const toggleValues = (recordId: string) => {
    setExpandedValues((prev) => {
      const next = new Set(prev);
      if (next.has(recordId)) next.delete(recordId);
      else next.add(recordId);
      return next;
    });
  };

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Nom</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Valeurs</TableHead>
          <TableHead className="w-[70px]">TTL</TableHead>
          <TableHead className="w-[70px]">Statut</TableHead>
          <TableHead className="w-[88px]">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {records.map((record) => {
          const expanded = expandedValues.has(record.id);
          const visibleValues = expanded ? record.values : record.values.slice(0, 2);
          const hiddenCount = record.values.length - visibleValues.length;
          return (
            <TableRow key={record.id}>
              <TableCell className="max-w-[220px] truncate font-mono" title={record.name}>
                {record.name}
              </TableCell>
              <TableCell>
                <span className="inline-flex items-center gap-1.5">
                  <Badge label={record.type} type="info" />
                  {record.isGeo && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <MapPin className="h-3.5 w-3.5 text-emerald-400" />
                      </TooltipTrigger>
                      <TooltipContent>Géo-routage actif</TooltipContent>
                    </Tooltip>
                  )}
                </span>
              </TableCell>
              <TableCell className="max-w-[280px]">
                <span className="whitespace-normal break-words font-mono text-xs text-muted-foreground">
                  {visibleValues.map((v) => v.content).join(', ')}
                </span>
                {hiddenCount > 0 && (
                  <button type="button" onClick={() => toggleValues(record.id)} className="ml-1.5 inline-block">
                    <Badge label={`+${hiddenCount} valeurs`} type="info" />
                  </button>
                )}
                {expanded && record.values.length > 2 && (
                  <button type="button" onClick={() => toggleValues(record.id)} className="ml-1.5 inline-block">
                    <Badge label="réduire" type="info" />
                  </button>
                )}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">{record.ttl}s</TableCell>
              <TableCell>
                <StatusIndicator status={record.status} compact />
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-1">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="icon" onClick={() => onEdit(record)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Modifier</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={busyKey === `record-${record.id}`}
                        onClick={() => onDelete(zoneId, record.id)}
                        className="text-rose-300 hover:text-rose-200"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Supprimer</TooltipContent>
                  </Tooltip>
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
