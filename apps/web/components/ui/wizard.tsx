'use client';

import { ReactNode, useState } from 'react';
import { ChevronDown, CheckCircle2, HelpCircle, AlertCircle, Info, TriangleAlert } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip';
import { Button } from './button';
import { Alert, AlertDescription, AlertTitle } from './alert';

export interface StepConfig {
  id: string;
  title: string;
  description: string;
  content: ReactNode;
}

interface WizardDialogProps {
  title: string;
  description?: string;
  steps: StepConfig[];
  onComplete: () => void;
  onCancel: () => void;
  completeButtonLabel?: string;
}

export function WizardDialog({
  title,
  description,
  steps,
  onComplete,
  onCancel,
  completeButtonLabel = 'Terminer',
}: WizardDialogProps) {
  const [currentStep, setCurrentStep] = useState(0);

  const step = steps[currentStep];
  const isLastStep = currentStep === steps.length - 1;
  const isFirstStep = currentStep === 0;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/70 p-4 backdrop-blur-sm sm:p-6">
      <div className="mx-auto flex w-full max-w-2xl flex-col rounded-2xl border border-white/[0.08] bg-zinc-950/95 shadow-2xl max-h-[calc(100dvh-2rem)] sm:max-h-[calc(100dvh-3rem)]">
        {/* Header */}
        <div className="shrink-0 border-b border-white/[0.08] px-6 py-4">
          <h2 className="text-xl font-bold text-foreground">{title}</h2>
          {description && <p className="text-sm text-muted-foreground mt-1">{description}</p>}
          
          {/* Progress Steps */}
          <div className="mt-4 flex gap-2">
            {steps.map((s, idx) => (
              <div
                key={s.id}
                className={`flex-1 h-1 rounded-full transition-all ${
                  idx <= currentStep ? 'bg-violet-500' : 'bg-zinc-800'
                }`}
              />
            ))}
          </div>
          <div className="mt-2 text-xs text-muted-foreground">
            Étape {currentStep + 1} de {steps.length}: {step.title}
          </div>
        </div>

        {/* Content */}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
          <div className="mb-4">
            <h3 className="font-semibold text-lg text-foreground">{step.title}</h3>
            <p className="text-sm text-muted-foreground mt-1">{step.description}</p>
          </div>
          <div className="mt-6">{step.content}</div>
        </div>

        {/* Footer */}
        <div className="shrink-0 flex justify-between gap-3 border-t border-white/[0.08] px-6 py-4">
          <Button variant="outline" onClick={onCancel}>
            Annuler
          </Button>

          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={() => setCurrentStep(Math.max(0, currentStep - 1))}
              disabled={isFirstStep}
            >
              Précédent
            </Button>

            {!isLastStep && (
              <Button
                onClick={() => setCurrentStep(Math.min(steps.length - 1, currentStep + 1))}
                className="bg-violet-600 text-white hover:bg-violet-500"
              >
                Suivant
              </Button>
            )}

            {isLastStep && (
              <Button
                onClick={onComplete}
                className="bg-emerald-600 text-white hover:bg-emerald-500"
              >
                {completeButtonLabel}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export interface PresetOption {
  id: string;
  name: string;
  description: string;
  icon?: ReactNode;
  config?: Record<string, any>;
}

export function PresetSelector({
  presets,
  onSelect,
  selectedId,
  title = 'Choisir un modèle',
  description,
}: {
  presets: PresetOption[];
  onSelect: (preset: PresetOption) => void;
  selectedId?: string;
  title?: string;
  description?: string;
}) {
  return (
    <div>
      {title && <h3 className="font-semibold text-lg text-foreground mb-2">{title}</h3>}
      {description && <p className="text-sm text-muted-foreground mb-4">{description}</p>}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {presets.map((preset) => {
          const isSelected = selectedId === preset.id;
          return (
            <button
              key={preset.id}
              type="button"
              aria-pressed={isSelected}
              onClick={() => onSelect(preset)}
              className={`rounded-xl border p-4 text-left transition-all ${
                isSelected
                  ? 'border-violet-500/60 bg-violet-500/[0.1] ring-1 ring-violet-500/20'
                  : 'border-white/[0.08] bg-zinc-900/70 hover:border-violet-400/40 hover:bg-zinc-900'
              }`}
            >
              <div className="flex items-start gap-3">
                {preset.icon && <div className="text-2xl mt-1">{preset.icon}</div>}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="font-semibold text-foreground">{preset.name}</h4>
                    {isSelected && <CheckCircle2 className="h-4 w-4 shrink-0 text-violet-400" />}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{preset.description}</p>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function AdvancedOptions({
  children,
  label = 'Options avancées',
}: {
  children: ReactNode;
  label?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="mt-6 border-t border-white/[0.08] pt-6">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 text-sm font-semibold text-foreground transition-colors hover:text-muted-foreground"
      >
        <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        {label}
      </button>

      {isOpen && <div className="mt-4 space-y-4">{children}</div>}
    </div>
  );
}

export interface OperationStep {
  id: string;
  title: string;
  description?: string;
  icon?: ReactNode;
}

export function OperationPreview({ steps }: { steps: OperationStep[] }) {
  return (
    <div className="rounded-xl border border-violet-500/30 bg-violet-500/[0.08] p-4">
      <h4 className="mb-3 font-semibold text-violet-300">Aperçu de l'opération</h4>
      <div className="space-y-3">
        {steps.map((step, idx) => (
          <div key={step.id} className="flex gap-3">
            <div className="flex-shrink-0">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-violet-600 text-sm font-semibold text-white">
                {idx + 1}
              </div>
            </div>
            <div className="flex-1">
              <p className="font-medium text-foreground">{step.title}</p>
              {step.description && <p className="text-sm text-muted-foreground mt-1">{step.description}</p>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function HelpText({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="ml-1 inline-flex">
          <HelpCircle className="h-4 w-4 text-zinc-500 hover:text-zinc-300" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{text}</TooltipContent>
    </Tooltip>
  );
}

export function InfoBox({
  type = 'info',
  title,
  children,
}: {
  type?: 'info' | 'warning' | 'error' | 'success';
  title?: string;
  children: ReactNode;
}) {
  const variants = {
    info: { icon: Info, variant: 'info' as const, title: title ?? 'Information' },
    warning: { icon: TriangleAlert, variant: 'warning' as const, title: title ?? 'Attention' },
    error: { icon: AlertCircle, variant: 'destructive' as const, title: title ?? 'Erreur' },
    success: { icon: CheckCircle2, variant: 'success' as const, title: title ?? 'Succès' },
  };
  const config = variants[type];
  const Icon = config.icon;

  return (
    <Alert variant={config.variant}>
      <Icon className="h-4 w-4" />
      <AlertTitle>{config.title}</AlertTitle>
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}
