"use client";

import { motion } from "framer-motion";
import { ReactNode } from "react";

interface MetricCardProps {
  title: string;
  value: string | number;
  icon: ReactNode;
  description?: string;
  delay?: number;
  trend?: {
    value: number;
    isPositive: boolean;
  };
}

export default function MetricCard({ title, value, icon, description, delay = 0, trend }: MetricCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay }}
      className="bg-zinc-950 border border-zinc-800 rounded-xl p-6 relative overflow-hidden group hover:border-red-900/50 transition-colors"
    >
      <div className="absolute -right-6 -top-6 text-zinc-900/50 group-hover:text-red-900/10 transition-colors w-32 h-32">
        {icon}
      </div>
      
      <div className="relative z-10 flex flex-col h-full justify-between">
        <div className="flex justify-between items-start mb-4">
          <p className="text-sm font-medium text-zinc-400">{title}</p>
          <div className="p-2 bg-zinc-900 rounded-lg text-zinc-300 group-hover:text-red-500 transition-colors">
            {icon}
          </div>
        </div>
        
        <div>
          <h3 className="text-3xl font-bold text-white tracking-tight">{value}</h3>
          
          <div className="flex items-center mt-2 gap-2">
            {trend && (
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${trend.isPositive ? 'bg-emerald-950 text-emerald-400' : 'bg-red-950 text-red-400'}`}>
                {trend.isPositive ? '+' : '-'}{Math.abs(trend.value)}%
              </span>
            )}
            {description && (
              <p className="text-xs text-zinc-500">{description}</p>
            )}
          </div>
        </div>
      </div>
      
      {/* Accent glow on hover */}
      <div className="absolute bottom-0 left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-red-600/0 to-transparent group-hover:via-red-600/50 transition-all duration-500"></div>
    </motion.div>
  );
}
