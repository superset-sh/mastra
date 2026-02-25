import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createStep, createWorkflow } from '../workflow';

describe('Parallel Steps with allSettled mode', () => {
  it('should succeed with partial results when one step fails in allSettled mode', async () => {
    const successStep = createStep({
      id: 'success-step',
      description: 'A step that succeeds',
      inputSchema: z.any(),
      outputSchema: z.object({ value: z.string() }),
      execute: async () => {
        return { value: 'ok' };
      },
    });

    const failingStep = createStep({
      id: 'failing-step',
      description: 'A step that throws',
      inputSchema: z.any(),
      outputSchema: z.object({ value: z.string() }),
      execute: async () => {
        throw new Error('Simulated auth token expiry');
      },
    });

    const workflow = createWorkflow({
      id: 'all-settled-workflow',
      inputSchema: z.any(),
      outputSchema: z.any(),
    })
      .parallel([successStep, failingStep], { mode: 'allSettled' })
      .commit();

    const run = await workflow.createRun();
    const result = await run.start({ inputData: {} });

    // In allSettled mode, the workflow should succeed even though one step failed
    expect(result.status).toBe('success');

    // The successful step's output should be in the result
    if (result.status === 'success') {
      expect(result.result['success-step']).toEqual({ value: 'ok' });
      // The failing step should not be in the output (it failed)
      expect(result.result['failing-step']).toBeUndefined();
    }
  });

  it('should still fail when a step fails in default (all) mode', async () => {
    const successStep = createStep({
      id: 'success-step',
      description: 'A step that succeeds',
      inputSchema: z.any(),
      outputSchema: z.object({ value: z.string() }),
      execute: async () => {
        return { value: 'ok' };
      },
    });

    const failingStep = createStep({
      id: 'failing-step',
      description: 'A step that throws',
      inputSchema: z.any(),
      outputSchema: z.object({ value: z.string() }),
      execute: async () => {
        throw new Error('Simulated failure');
      },
    });

    const workflow = createWorkflow({
      id: 'default-parallel-workflow',
      inputSchema: z.any(),
      outputSchema: z.any(),
    })
      .parallel([successStep, failingStep])
      .commit();

    const run = await workflow.createRun();
    const result = await run.start({ inputData: {} });

    // Default mode: any failure fails the whole block
    expect(result.status).toBe('failed');
  });

  it('should succeed with all results when no steps fail in allSettled mode', async () => {
    const step1 = createStep({
      id: 'step-1',
      description: 'First step',
      inputSchema: z.any(),
      outputSchema: z.object({ value: z.number() }),
      execute: async () => ({ value: 1 }),
    });

    const step2 = createStep({
      id: 'step-2',
      description: 'Second step',
      inputSchema: z.any(),
      outputSchema: z.object({ value: z.number() }),
      execute: async () => ({ value: 2 }),
    });

    const step3 = createStep({
      id: 'step-3',
      description: 'Third step',
      inputSchema: z.any(),
      outputSchema: z.object({ value: z.number() }),
      execute: async () => ({ value: 3 }),
    });

    const workflow = createWorkflow({
      id: 'all-settled-happy-path',
      inputSchema: z.any(),
      outputSchema: z.any(),
    })
      .parallel([step1, step2, step3], { mode: 'allSettled' })
      .commit();

    const run = await workflow.createRun();
    const result = await run.start({ inputData: {} });

    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.result['step-1']).toEqual({ value: 1 });
      expect(result.result['step-2']).toEqual({ value: 2 });
      expect(result.result['step-3']).toEqual({ value: 3 });
    }
  });

  it('should succeed with empty output when all steps fail in allSettled mode', async () => {
    const failing1 = createStep({
      id: 'fail-1',
      description: 'Fails',
      inputSchema: z.any(),
      outputSchema: z.any(),
      execute: async () => {
        throw new Error('Error 1');
      },
    });

    const failing2 = createStep({
      id: 'fail-2',
      description: 'Also fails',
      inputSchema: z.any(),
      outputSchema: z.any(),
      execute: async () => {
        throw new Error('Error 2');
      },
    });

    const workflow = createWorkflow({
      id: 'all-settled-all-fail',
      inputSchema: z.any(),
      outputSchema: z.any(),
    })
      .parallel([failing1, failing2], { mode: 'allSettled' })
      .commit();

    const run = await workflow.createRun();
    const result = await run.start({ inputData: {} });

    // Even when all steps fail, allSettled mode doesn't fail the block
    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.result['fail-1']).toBeUndefined();
      expect(result.result['fail-2']).toBeUndefined();
    }
  });

  it('should allow a downstream step to consume partial results from allSettled', async () => {
    const researcherA = createStep({
      id: 'researcher-a',
      description: 'Succeeds with a brief',
      inputSchema: z.any(),
      outputSchema: z.object({ brief: z.string(), available: z.boolean() }),
      execute: async () => ({ brief: 'GitHub activity found', available: true }),
    });

    const researcherB = createStep({
      id: 'researcher-b',
      description: 'Fails due to auth',
      inputSchema: z.any(),
      outputSchema: z.object({ brief: z.string(), available: z.boolean() }),
      execute: async () => {
        throw new Error('Composio auth token expired');
      },
    });

    const researcherC = createStep({
      id: 'researcher-c',
      description: 'Succeeds with a brief',
      inputSchema: z.any(),
      outputSchema: z.object({ brief: z.string(), available: z.boolean() }),
      execute: async () => ({ brief: 'Slack messages found', available: true }),
    });

    const writerStep = createStep({
      id: 'writer',
      description: 'Aggregates results from available researchers',
      inputSchema: z.any(),
      outputSchema: z.object({ synthesis: z.string(), briefCount: z.number() }),
      execute: async ({ inputData }) => {
        // inputData is { 'researcher-a': {...}, 'researcher-c': {...} }
        // researcher-b is missing because it failed
        const briefs = Object.values(inputData).filter((v: any) => v && typeof v === 'object' && 'brief' in v);
        return {
          synthesis: briefs.map((b: any) => b.brief).join('; '),
          briefCount: briefs.length,
        };
      },
    });

    const workflow = createWorkflow({
      id: 'newsroom-pattern',
      inputSchema: z.any(),
      outputSchema: z.any(),
    })
      .parallel([researcherA, researcherB, researcherC], { mode: 'allSettled' })
      .then(writerStep)
      .commit();

    const run = await workflow.createRun();
    const result = await run.start({ inputData: {} });

    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.result.briefCount).toBe(2);
      expect(result.result.synthesis).toContain('GitHub');
      expect(result.result.synthesis).toContain('Slack');
    }
  });
});
