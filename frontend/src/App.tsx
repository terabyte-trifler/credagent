import { AgentStatus } from "./components/AgentStatus";
import { CreditExplorer } from "./components/CreditExplorer";
import { LoanManager } from "./components/LoanManager";
import { PoolDashboard } from "./components/PoolDashboard";
import { NegotiationChat } from "./components/NegotiationChat";
import { DecisionLog } from "./components/DecisionLog";
import { DemoButton } from "./components/DemoButton";
import "./styles/globals.css";

export default function App() {
  return (
    <main>
      <h1>CredAgent</h1>
      <DemoButton />
      <AgentStatus />
      <CreditExplorer />
      <LoanManager />
      <PoolDashboard />
      <NegotiationChat />
      <DecisionLog />
    </main>
  );
}
