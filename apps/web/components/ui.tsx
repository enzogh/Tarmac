'use client';

import { ReactNode } from 'react';

interface CardProps {
  title?: string;
  children: ReactNode;
  className?: string;
}

export function Card({ title, children, className = '' }: CardProps) {
  return (
    <div className={`card ${className}`}>
      {title && <h3 className="text-lg font-semibold mb-4 text-slate-100">{title}</h3>}
      {children}
    </div>
  );
}

interface StatCardProps {
  label: string;
  value: string | number;
  icon?: string;
  change?: string;
  changeType?: 'up' | 'down' | 'neutral';
}

export function StatCard({ label, value, icon, change, changeType }: StatCardProps) {
  return (
    <div className="card bg-gradient-to-br from-slate-800 to-slate-900">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-slate-400 mb-1">{label}</p>
          <p className="text-3xl font-bold text-slate-100">{value}</p>
          {change && (
            <p
              className={`text-xs mt-2 ${
                changeType === 'up'
                  ? 'text-green-400'
                  : changeType === 'down'
                    ? 'text-red-400'
                    : 'text-slate-400'
              }`}
            >
              {change}
            </p>
          )}
        </div>
        {icon && <span className="text-4xl opacity-50">{icon}</span>}
      </div>
    </div>
  );
}

interface BadgeProps {
  label: string;
  type?: 'success' | 'warning' | 'error' | 'info';
  icon?: string;
}

export function Badge({ label, type = 'info', icon }: BadgeProps) {
  const typeClasses = {
    success: 'badge-success',
    warning: 'badge-warning',
    error: 'badge-error',
    info: 'badge-info',
  };

  return (
    <span className={`badge ${typeClasses[type]}`}>
      {icon && <span className="mr-1">{icon}</span>}
      {label}
    </span>
  );
}

interface TableProps {
  headers: string[];
  rows: (string | number | ReactNode)[][];
}

export function Table({ headers, rows }: TableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            {headers.map((header, i) => (
              <th key={i}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
