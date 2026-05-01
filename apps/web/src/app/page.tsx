import Link from "next/link";
import { STRATEGY_SUMMARIES } from "@/lib/eval-data";

export default function Home() {
  return (
    <main className="container mx-auto max-w-5xl px-4 py-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Runs</h1>
        <Link
          href="/compare"
          className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
        >
          Open Compare View
        </Link>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-4 py-3 font-medium">strategy</th>
              <th className="px-4 py-3 font-medium">avgOverallScore</th>
              <th className="px-4 py-3 font-medium">avgFinalScore</th>
              <th className="px-4 py-3 font-medium">avgHallucinationPenalty</th>
              <th className="px-4 py-3 font-medium">cases</th>
            </tr>
          </thead>
          <tbody>
            {STRATEGY_SUMMARIES.map((row) => (
              <tr key={row.strategy} className="border-t">
                <td className="px-4 py-3 font-medium">{row.strategy}</td>
                <td className="px-4 py-3">{row.avgOverallScore.toFixed(4)}</td>
                <td className="px-4 py-3">{row.avgFinalScore.toFixed(4)}</td>
                <td className="px-4 py-3">{row.avgHallucinationPenalty.toFixed(4)}</td>
                <td className="px-4 py-3">{row.cases}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
