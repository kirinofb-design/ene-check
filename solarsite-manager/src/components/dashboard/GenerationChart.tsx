"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

interface DataPoint {
  date: string;
  [key: string]: string | number;
}

interface Props {
  data: DataPoint[];
  siteNames: string[];
}

export function GenerationChart({ data, siteNames }: Props) {
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          <XAxis
            dataKey="date"
            stroke="#94a3b8"
            tick={{ fontSize: 10 }}
            tickFormatter={(v) => v.slice(5)}
          />
          <YAxis stroke="#94a3b8" tick={{ fontSize: 10 }} />
          <Tooltip
            contentStyle={{
              backgroundColor: "#1e293b",
              border: "1px solid #334155",
              borderRadius: "6px",
            }}
            labelStyle={{ color: "#94a3b8" }}
          />
          <Legend />
          {siteNames.map((name, i) => {
            const colors = ["#0ea5e9", "#22c55e", "#eab308", "#f97316", "#ec4899", "#8b5cf6"];
            const color = colors[i % colors.length];
            return (
              <Line
                key={name}
                type="monotone"
                dataKey={name}
                stroke={color}
                dot={false}
                strokeWidth={2}
                name={name}
              />
            );
          })}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
