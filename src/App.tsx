import { NativeWorkspace } from "./native/NativeWorkspace";
import { PublicLanding } from "./web/PublicLanding";

export default function App() {
  return window.otto ? <NativeWorkspace /> : <PublicLanding />;
}
