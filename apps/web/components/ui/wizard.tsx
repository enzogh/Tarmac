'use client';

import { ReactNode, useState } from 'react';
import { ChevronDown, HelpCircle, AlertCircle } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip';

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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-lg max-w-2xl w-full mx-4">
        {/* Header */}
        <div className="border-b border-gray-200 px-6 py-4">
          <h2 className="text-xl font-bold text-gray-900">{title}</h2>
          {description && <p className="text-sm text-gray-600 mt-1">{description}</p>}
          
          {/* Progress Steps */}
          <div className="mt-4 flex gap-2">
            {steps.map((s, idx) => (
              <div
                key={s.id}
                className={`flex-1 h-1 rounded-full transition-all ${
                  idx <= currentStep ? 'bg-blue-600' : 'bg-gray-200'
                }`}
              />
            ))}
          </div>
          <div className="mt-2 text-xs text-gray-600">
            Étape {currentStep + 1} de {steps.length}: {step.title}
          </div>
        </div>

        {/* Content */}
        <div className="px-6 py-6 min-h-64">
          <div className="mb-4">
            <h3 className="font-semibold text-lg text-gray-900">{step.title}</h3>
            <p className="text-sm text-gray-600 mt-1">{step.description}</p>
          </div>
          <div className="mt-6">{step.content}</div>
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 px-6 py-4 flex justify-between gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 font-medium"
          >
            Annuler
          </button>

          <div className="flex gap-3">
            <button
              onClick={() => setCurrentStep(Math.max(0, currentStep - 1))}
              disabled={isFirstStep}
              className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Précédent
            </button>

            {!isLastStep && (
              <button
                onClick={() => setCurrentStep(Math.min(steps.length - 1, currentStep + 1))}
                className="px-4 py-2 text-white bg-blue-600 rounded-lg hover:bg-blue-700 font-medium"
              >
                Suivant
              </button>
            )}

            {isLastStep && (
              <button
                onClick={onComplete}
                className="px-4 py-2 text-white bg-green-600 rounded-lg hover:bg-green-700 font-medium"
              >
                {completeButtonLabel}
              </button>
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
  title = 'Choisir un modèle',
  description,
}: {
  presets: PresetOption[];
  onSelect: (preset: PresetOption) => void;
  title?: string;
  description?: string;
}) {
  return (
    <div>
      {title && <h3 className="font-semibold text-lg mb-2">{title}</h3>}
      {description && <p className="text-sm text-gray-600 mb-4">{description}</p>}
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {presets.map((preset) => (
          <button
            key={preset.id}
            onClick={() => onSelect(preset)}
            className="p-4 border-2 border-gray-200 rounded-lg hover:border-blue-500 hover:bg-blue-50 transition-all text-left"
          >
            <div className="flex items-start gap-3">
              {preset.icon && <div className="text-2xl mt-1">{preset.icon}</div>}
              <div>
                <h4 className="font-semibold text-gray-900">{preset.name}</h4>
                <p className="text-xs text-gray-600 mt-1">{preset.description}</p>
              </div>
            </div>
          </button>
        ))}
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
    <div className="border-t border-gray-200 mt-6 pt-6">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 text-sm font-semibold text-gray-700 hover:text-gray-900"
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
    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
      <h4 className="font-semibold text-blue-900 mb-3">Aperçu de l'opération</h4>
      <div className="space-y-3">
        {steps.map((step, idx) => (
          <div key={step.id} className="flex gap-3">
            <div className="flex-shrink-0">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-white text-sm font-semibold">
                {idx + 1}
              </div>
            </div>
            <div className="flex-1">
              <p className="font-medium text-gray-900">{step.title}</p>
              {step.description && <p className="text-sm text-gray-600 mt-1">{step.description}</p>}
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
        <button className="ml-1 inline-flex">
          <HelpCircle className="w-4 h-4 text-gray-400 hover:text-gray-600" />
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
  const styles = {
    info: 'bg-blue-50 border-blue-200 text-blue-900',
    warning: 'bg-yellow-50 border-yellow-200 text-yellow-900',
    error: 'bg-red-50 border-red-200 text-red-900',
    success: 'bg-green-50 border-green-200 text-green-900',
  };

  const icons = {
    info: '💡',
    warning: '⚠️',
    error: '❌',
    success: '✅',
  };

  return (
    <div className={`border rounded-lg p-4 ${styles[type]}`}>
      <div className="flex gap-3">
        <span className="text-lg">{icons[type]}</span>
        <div>
          {title && <p className="font-semibold">{title}</p>}
          <div className="text-sm mt-1">{children}</div>
        </div>
      </div>
    </div>
  );
}
