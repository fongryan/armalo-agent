/**
 * Swarm Demo Example
 *
 * Shows how to run multiple specialized agents as a coordinated swarm
 * using the Armalo SDK's swarm primitives.
 *
 * This example creates a 3-agent research pipeline:
 *   Researcher → Fact-Checker → Synthesizer
 *
 * Run: npx tsx examples/swarm-demo.ts
 */

import 'dotenv/config';
import { TrustNativeAgent, RESEARCH_PACT, SAFETY_DEFAULTS } from '../src/index.js';
import { definePact } from '@armalo/core';

// Fact-checker commits to high accuracy and explicit uncertainty
const FACT_CHECKER_PACT = definePact({
  name: 'Adversarial Fact Checker',
  conditions: [
    {
      type: 'accuracy',
      operator: 'gte',
      value: 0.98,
      severity: 'critical',
      verificationMethod: 'jury',
      description: 'Must only assert claims that can be verified',
    },
    {
      type: 'confidence',
      operator: 'gte',
      value: 0.9,
      severity: 'major',
      verificationMethod: 'heuristic',
      description: 'Must flag uncertain claims explicitly',
    },
  ],
});

// Synthesizer commits to coherence and non-repetition
const SYNTHESIZER_PACT = definePact({
  name: 'Coherent Synthesizer',
  conditions: [
    {
      type: 'output_format',
      operator: 'matches',
      value: 'structured_report',
      severity: 'minor',
      verificationMethod: 'deterministic',
    },
    {
      type: 'reliability',
      operator: 'gte',
      value: 0.9,
      severity: 'major',
      verificationMethod: 'jury',
    },
  ],
});

async function runSwarm(topic: string): Promise<void> {
  console.log('\n' + '═'.repeat(60));
  console.log(`\x1b[1mSwarm Research Pipeline\x1b[0m`);
  console.log(`Topic: ${topic}`);
  console.log('═'.repeat(60));

  // Agent 1: Researcher — gathers raw information
  const researcher = new TrustNativeAgent({
    pacts: [SAFETY_DEFAULTS, RESEARCH_PACT],
    showTrustScore: false,
    systemPrompt: `You are a research specialist. Your job is to gather comprehensive raw information about a topic. Use web_search and fetch_url tools extensively. Return structured bullet points of findings with sources.`,
  });

  console.log('\n\x1b[33m[Researcher]\x1b[0m Gathering information...');
  const researchResult = await researcher.run(
    `Gather comprehensive information about: ${topic}. Use search tools to find 3-5 key facts with sources.`,
  );
  console.log(`Found ${researchResult.session.toolCallCount} sources in ${researchResult.session.iterations} turns`);

  // Agent 2: Fact-Checker — adversarially verifies the research
  const factChecker = new TrustNativeAgent({
    pacts: [FACT_CHECKER_PACT],
    showTrustScore: false,
    systemPrompt: `You are an adversarial fact-checker. Your job is to critically evaluate claims and flag anything uncertain or incorrect. For each claim provided, rate it as VERIFIED, UNCERTAIN, or UNVERIFIED.`,
  });

  console.log('\n\x1b[31m[Fact-Checker]\x1b[0m Verifying claims...');
  const factCheckResult = await factChecker.run(
    `Fact-check these research findings:\n\n${researchResult.output}`,
  );
  console.log(`Verified in ${factCheckResult.session.iterations} turns`);

  // Agent 3: Synthesizer — produces the final report
  const synthesizer = new TrustNativeAgent({
    pacts: [SYNTHESIZER_PACT, SAFETY_DEFAULTS],
    showTrustScore: true, // Show score for the final output
    systemPrompt: `You are a synthesis specialist. Your job is to combine research and fact-checking into a coherent, well-structured final report. Format: ## Overview, ## Key Findings (numbered), ## Confidence Assessment, ## Sources.`,
  });

  console.log('\n\x1b[34m[Synthesizer]\x1b[0m Producing final report...');
  const finalResult = await synthesizer.run(
    `Synthesize this research and fact-check into a final report:\n\n## Research:\n${researchResult.output}\n\n## Fact-Check:\n${factCheckResult.output}`,
  );

  console.log('\n' + '─'.repeat(60));
  console.log('\x1b[1mFinal Report:\x1b[0m');
  console.log('─'.repeat(60));
  console.log(finalResult.output);

  const totalTokens =
    researchResult.session.totalInputTokens + researchResult.session.totalOutputTokens +
    factCheckResult.session.totalInputTokens + factCheckResult.session.totalOutputTokens +
    finalResult.session.totalInputTokens + finalResult.session.totalOutputTokens;

  console.log(`\n\x1b[2mSwarm complete: 3 agents · ${totalTokens} total tokens\x1b[0m`);
}

const topic = process.argv[2] ?? 'the state of AI agent trust and safety in 2025';
runSwarm(topic).catch(console.error);
