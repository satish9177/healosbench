import { Button } from "@test-evals/ui/components/button";
import Link from "next/link";

export default function UserMenu() {
  return (
    <Link href="/login">
      <Button variant="outline">Sign In</Button>
    </Link>
  );
}
