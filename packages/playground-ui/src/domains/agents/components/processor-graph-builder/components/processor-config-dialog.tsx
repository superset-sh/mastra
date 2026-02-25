import { useState } from 'react';
import { SideDialog } from '@/ds/components/SideDialog';
import { Button } from '@/ds/components/Button';
import { Checkbox } from '@/ds/components/Checkbox';
import type { ProcessorGraphStep, ProcessorPhase } from '../types';
import { useProcessorProviderDetails } from '@/domains/processors/hooks';

interface ProcessorConfigDialogProps {
  step: ProcessorGraphStep;
  isOpen: boolean;
  onClose: () => void;
  onSave: (config: Record<string, unknown>, enabledPhases: ProcessorPhase[]) => void;
}

export function ProcessorConfigDialog({ step, isOpen, onClose, onSave }: ProcessorConfigDialogProps) {
  const { data: providerDetails } = useProcessorProviderDetails(step.providerId || null);
  const [config, setConfig] = useState<Record<string, unknown>>(step.config);
  const [enabledPhases, setEnabledPhases] = useState<ProcessorPhase[]>(step.enabledPhases);

  const availablePhases = (providerDetails?.availablePhases ?? []) as ProcessorPhase[];

  const togglePhase = (phase: ProcessorPhase) => {
    setEnabledPhases(prev => (prev.includes(phase) ? prev.filter(p => p !== phase) : [...prev, phase]));
  };

  const handleSave = () => {
    onSave(config, enabledPhases);
    onClose();
  };

  return (
    <SideDialog
      dialogTitle={`Configure ${providerDetails?.name ?? step.providerId}`}
      dialogDescription="Configure processor settings and enabled phases"
      isOpen={isOpen}
      onClose={onClose}
      level={3}
    >
      <SideDialog.Top>
        <span className="flex-1">Configure Processor</span>
        <div className="flex items-center gap-2 mr-6">
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={handleSave} disabled={enabledPhases.length === 0}>
            Save
          </Button>
        </div>
      </SideDialog.Top>

      <SideDialog.Content>
        <div className="flex flex-col gap-6">
          <div>
            <h4 className="text-ui-sm font-medium text-neutral5 mb-3">Enabled Phases</h4>
            <div className="flex flex-col gap-2">
              {availablePhases.map(phase => (
                <label key={phase} className="flex items-center gap-2 text-ui-sm text-neutral5 cursor-pointer">
                  <Checkbox checked={enabledPhases.includes(phase)} onCheckedChange={() => togglePhase(phase)} />
                  {phase}
                </label>
              ))}
              {availablePhases.length === 0 && <p className="text-ui-sm text-neutral3">Loading available phases...</p>}
            </div>
          </div>

          {providerDetails?.configSchema && Object.keys(providerDetails.configSchema).length > 0 && (
            <div>
              <h4 className="text-ui-sm font-medium text-neutral5 mb-3">Configuration</h4>
              <p className="text-ui-xs text-neutral3">
                Configuration form will be rendered from the provider's config schema.
              </p>
            </div>
          )}
        </div>
      </SideDialog.Content>
    </SideDialog>
  );
}
