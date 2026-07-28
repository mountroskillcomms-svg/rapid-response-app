/* ============================================================
   CHARTS — recharts-backed visualisations, split into their own
   module so recharts (~heavy) is lazy-loaded on first chart view
   instead of shipping in the initial bundle. Imported via
   React.lazy() from RapidResponseBrief.jsx; nothing in the main
   bundle may static-import this file, or recharts comes back with it.
   ============================================================ */
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, ReferenceLine,
  ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis,
} from "recharts";
import { PARTY_ORDER, PARTY_LABELS, PARTY_COLORS } from "./vault.js";

/** Second-brain explorer: national party-vote poll trend, all seven parties. */
export function PollTrendChart({ series }) {
  return (
    <ResponsiveContainer width="100%" height={340}>
      <LineChart data={series} margin={{ left: 0, right: 16, top: 8, bottom: 8 }}>
        <CartesianGrid strokeDasharray="2 4" stroke="#292524" />
        <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#a8a29e" }} stroke="#57534e" />
        <YAxis tick={{ fontSize: 10, fill: "#a8a29e" }} stroke="#57534e" domain={[0, "auto"]} />
        <Tooltip contentStyle={{ background: "#0c0a09", border: "1px solid #44403c", fontSize: 11 }} labelStyle={{ color: "#f5f5f4" }} itemSorter={(it) => -it.value} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        {PARTY_ORDER.map((k) => (
          <Line key={k} type="monotone" dataKey={k} name={PARTY_LABELS[k]} stroke={PARTY_COLORS[k]} strokeWidth={k === "labour" || k === "national" ? 2.5 : 1.5} dot={false} connectNulls />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

/** War Room: capability gap by issue (horizontal, Labour-left / National-right). */
export function CapabilityGapChart({ gapData, leaderFill }) {
  return (
    <ResponsiveContainer width="100%" height={Math.max(220, gapData.length * 34 + 40)}>
      <BarChart data={gapData} layout="vertical" margin={{ left: 8, right: 40, top: 8, bottom: 24 }}>
        <CartesianGrid strokeDasharray="2 4" stroke="#292524" />
        <XAxis type="number" tick={{ fontSize: 10, fill: "#a8a29e" }} stroke="#57534e" label={{ value: "← Labour leads · Points · National leads →", position: "insideBottom", offset: -8, fontSize: 10, fill: "#a8a29e" }} />
        <YAxis type="category" dataKey="name" width={160} tick={{ fontSize: 10, fill: "#d6d3d1" }} stroke="#57534e" />
        <Tooltip contentStyle={{ background: "#0c0a09", border: "1px solid #44403c", fontSize: 11, color: "#f5f5f4" }} formatter={(v) => [`${v > 0 ? "National +" : "Labour +"}${Math.abs(v)} pts`, "Capability gap"]} />
        <ReferenceLine x={0} stroke="#a8a29e" strokeWidth={1.5} />
        <Bar dataKey="gap" radius={[2, 2, 2, 2]}>
          {gapData.map((d, i) => <Cell key={i} fill={leaderFill(d.leader)} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** War Room: terrain quadrant map — issue salience (x) × capability gap (y). */
export function TerrainScatter({ scatterData, leaderFill }) {
  return (
    <ResponsiveContainer width="100%" height={320}>
      <ScatterChart margin={{ left: 24, right: 40, top: 20, bottom: 40 }}>
        <CartesianGrid strokeDasharray="2 4" stroke="#292524" />
        <XAxis type="number" dataKey="x" name="Salience" unit="%" tick={{ fontSize: 10, fill: "#a8a29e" }} stroke="#57534e" label={{ value: "Issue salience (% naming top) →", position: "insideBottom", offset: -12, fontSize: 11, fill: "#d6d3d1" }} />
        <YAxis type="number" dataKey="y" name="Gap" tick={{ fontSize: 10, fill: "#a8a29e" }} stroke="#57534e" label={{ value: "← Labour leads · Capability gap · National leads →", angle: -90, position: "insideLeft", offset: 0, fontSize: 10, fill: "#d6d3d1" }} />
        <ReferenceLine y={0} stroke="#a8a29e" strokeWidth={1.5} />
        <Tooltip content={({ payload }) => payload?.length ? (
          <div className="bg-black border border-stone-700 rounded-sm px-2 py-1.5 text-xs shadow-lg">
            <p className="font-bold text-stone-100">{payload[0].payload.name}</p>
            <p className="text-stone-400">Salience {payload[0].payload.x}% · {payload[0].payload.y > 0 ? `National +${payload[0].payload.y}` : `Labour +${Math.abs(payload[0].payload.y)}`} pts</p>
          </div>
        ) : null} />
        <Scatter data={scatterData}>
          {scatterData.map((d, i) => <Cell key={i} fill={leaderFill(d.leader)} />)}
        </Scatter>
      </ScatterChart>
    </ResponsiveContainer>
  );
}
