import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Card, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';

/** Numbered how-to, the way the guides walk through a first setup. */
export function DocSteps({ steps }: { steps: Array<{ title: string; text: ReactNode }> }) {
  return (
    <ol className="space-y-3">
      {steps.map((step, index) => (
        <li key={step.title} className="flex gap-4 rounded-xl border border-border bg-surface-1/40 p-4">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">{index + 1}</span>
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">{step.title}</p>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{step.text}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** A titled explanation card; a grid of them reads as "the things to know". */
export function DocCard({ icon: Icon, title, children, tone }: { icon?: LucideIcon; title: string; children: ReactNode; tone?: 'warn' }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {Icon && <Icon className={tone === 'warn' ? 'h-4 w-4 text-amber-400' : 'h-4 w-4 text-muted-foreground'} />}
          {title}
        </CardTitle>
        <CardDescription className="leading-relaxed">{children}</CardDescription>
      </CardHeader>
    </Card>
  );
}

/** Two-column reference table ("Mode" / "What it does"). */
export function DocTable({ head, rows }: { head: [string, string]; rows: Array<[ReactNode, ReactNode]> }) {
  return (
    <Card>
      <div className="p-2">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-48">{head[0]}</TableHead>
              <TableHead>{head[1]}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(([left, right], index) => (
              <TableRow key={index}>
                <TableCell className="align-top text-sm font-medium text-foreground">{left}</TableCell>
                <TableCell className="text-sm leading-relaxed text-muted-foreground">{right}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}
