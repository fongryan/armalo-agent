/**
 * LangGraph Agent Example
 *
 * Shows how to add Armalo trust observability to a LangGraph state machine
 * with a single createArmaloNode() tap node.
 *
 * Run: npx tsx examples/langgraph-agent.ts
 * Requires: ANTHROPIC_API_KEY + optional ARMALO_API_KEY in .env
 * Install: npm install @langchain/langgraph @langchain/anthropic
 */

import 'dotenv/config';

// Dynamic import so this example only fails when langgraph is actually needed
async function main() {
  let StateGraph: typeof import('@langchain/langgraph').StateGraph;
  let ChatAnthropic: typeof import('@langchain/anthropic').ChatAnthropic;
  let createArmaloNode: typeof import('@armalo/integrations').createArmaloNode;

  try {
    const lg = await import('@langchain/langgraph');
    const la = await import('@langchain/anthropic');
    const ai = await import('@armalo/integrations');
    StateGraph = lg.StateGraph;
    ChatAnthropic = la.ChatAnthropic;
    createArmaloNode = ai.createArmaloNode;
  } catch {
    console.error('Missing dependencies. Run: npm install @langchain/langgraph @langchain/anthropic');
    process.exit(1);
  }

  console.log('\n\x1b[1mLangGraph Agent with Armalo Trust Observability\x1b[0m\n');

  const model = new ChatAnthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: 'claude-opus-4-8',
  });

  // Define state graph
  const { MessagesAnnotation } = await import('@langchain/langgraph');

  const graph = new StateGraph(MessagesAnnotation)
    .addNode('agent', async (state: { messages: unknown[] }) => {
      const response = await model.invoke(state.messages as Parameters<typeof model.invoke>[0]);
      return { messages: [response] };
    })
    // ── Add Armalo trust tap node (1 line) ────────────────────────────────
    .addNode('armalo_trust', createArmaloNode({
      apiKey: process.env.ARMALO_API_KEY,
      agentId: process.env.ARMALO_AGENT_ID ?? 'langgraph-demo-agent',
      pactName: 'LangGraph Agent',
      // Emit a room event for live monitoring
      emitRoomEvents: true,
    }))
    .addEdge('__start__', 'agent')
    .addEdge('agent', 'armalo_trust')  // Wire trust node after agent
    .addEdge('armalo_trust', '__end__')
    .compile();

  const result = await graph.invoke({
    messages: [
      {
        role: 'user',
        content: 'What are the key principles of behavioral AI alignment?',
      },
    ],
  });

  const lastMessage = result.messages[result.messages.length - 1];
  console.log('\x1b[1mLangGraph Response:\x1b[0m');
  console.log(typeof lastMessage?.content === 'string' ? lastMessage.content : JSON.stringify(lastMessage?.content));
  console.log('\n\x1b[2mArmalo trust telemetry emitted via the armalo_trust node.\x1b[0m');
  console.log('\x1b[2mView at: https://armalo.ai/dashboard\x1b[0m\n');
}

main().catch(console.error);
