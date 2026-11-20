# Questions for the TSG contact

Draft for Vinny to send. Edit freely.

---

Hi! I'm building my exercise submission: a Chord teammate for a fictional Lagos food vendor. It takes WhatsApp orders and confirms them only after Paystack (test mode) verifies the payment. Three quick questions so I don't burn credits guessing:

1. **WhatsApp simulator:** what's the intended way to connect a teammate to chat.tsglabs.dev? I can see "Sign in with Chord" on the simulator. Is it enough to sign in and pick the teammate there, or does something need to be enabled first (a Chord Connect app approval, or an external-chat connector setting in the workspace)?
2. **Custom tools:** I've built the tool as a remote MCP server (Streamable HTTP on Vercel, bearer auth) and plan to register it through `POST /v1/workspaces/{id}/mcp-servers`. Is a remote MCP server the intended path for custom tools, or is there a native HTTP tool type I should use instead?
3. **API key scopes:** does my API key have `mcp:create`, `mcp:read`, `mcp:manage`, `teammate:update` and `orchestrator:chat`? Or should MCP setup and skill upload go through the app? I'm planning to create the teammate itself in the app, since `teammate:create` isn't in the integration profiles.

Thanks!
