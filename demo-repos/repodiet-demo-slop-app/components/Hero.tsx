import { Button } from "./Button";

export function Hero() {
  return (
    <section className="flex flex-col items-center gap-6 py-16 text-center">
      <h1 className="text-4xl font-bold tracking-tight">Demo Slop App</h1>
      <p className="max-w-md text-gray-600">
        Intentional AI-code-bloat patterns for RepoDiet demo scanning.
      </p>
      <Button variant="primary" size="lg">
        Get Started
      </Button>
    </section>
  );
}
