"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

/** Last-resort boundary: a rendering bug shows a recoverable screen instead of a blank page. */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <h1 className="text-xl font-semibold">Something went wrong · कुछ गड़बड़ हो गई</h1>
      <p className="mt-2 text-muted-foreground">
        Please try again. If it keeps happening, call the Kisan Call Centre (1800-180-1551).
      </p>
      <Button className="mt-6" onClick={reset}>
        Try again · फिर कोशिश करें
      </Button>
    </div>
  );
}
