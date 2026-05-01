import Link from "next/link";
import { FIELD_COMPARISON } from "@/lib/eval-data";

const LEFT = "few_shot";
const RIGHT = "cot";

function scoreFor(
  row: (typeof FIELD_COMPARISON)[number],
  strategy: typeof LEFT | typeof RIGHT,
): number {
  return strategy === "few_shot" ? row.few_shot : row.cot;
}

export default function ComparePage() {
  return (
    <main className="container mx-auto max-w-5xl px-4 py-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Compare View</h1>
        <Link href="/" className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted">
          Back to Runs
        </Link>
      </div>

      <div className="mb-4 rounded-lg border p-3 text-sm">
        Comparing <span className="font-medium">{LEFT}</span> vs{" "}
        <span className="font-medium">{RIGHT}</span>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-4 py-3 font-medium">field</th>
              <th className="px-4 py-3 font-medium">{LEFT}</th>
              <th className="px-4 py-3 font-medium">{RIGHT}</th>
              <th className="px-4 py-3 font-medium">delta ({RIGHT} - {LEFT})</th>
              <th className="px-4 py-3 font-medium">winner</th>
            </tr>
          </thead>
          <tbody>
            {FIELD_COMPARISON.map((row) => {
              const leftScore = scoreFor(row, LEFT);
              const rightScore = scoreFor(row, RIGHT);
              const delta = rightScore - leftScore;
              const rightWins = delta > 0;
              const leftWins = delta < 0;
              const winner = rightWins ? RIGHT : leftWins ? LEFT : "tie";
              return (
                <tr key={row.field} className="border-t">
                  <td className="px-4 py-3 font-medium">{row.field}</td>
                  <td className={`px-4 py-3 ${leftWins ? "text-green-600" : rightWins ? "text-red-600" : ""}`}>
                    {leftScore.toFixed(3)}
                  </td>
                  <td className={`px-4 py-3 ${rightWins ? "text-green-600" : leftWins ? "text-red-600" : ""}`}>
                    {rightScore.toFixed(3)}
                  </td>
                  <td className={`px-4 py-3 ${delta > 0 ? "text-green-600" : delta < 0 ? "text-red-600" : ""}`}>
                    {delta >= 0 ? "+" : ""}
                    {delta.toFixed(3)}
                  </td>
                  <td className={`px-4 py-3 font-medium ${winner === "tie" ? "" : winner === RIGHT ? "text-green-600" : "text-red-600"}`}>
                    {winner}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </main>
  );
}
