"use client";

import React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LayoutDashboard, FileCode2, FileBarChart2, LogOut, Settings } from 'lucide-react';
import api from '@/lib/api';

const Sidebar = () => {
  const pathname = usePathname();
  const router = useRouter();

  // If we are on login or change-password, don't show sidebar
  if (pathname === '/login' || pathname === '/change-password') {
    return null;
  }

  const menuItems = [
    { icon: LayoutDashboard, label: 'Dashboard', path: '/dashboard' },
    { icon: FileCode2, label: 'Landing Pages', path: '/landing-pages' },
    { icon: FileBarChart2, label: 'Reports', path: '/reports' },
    { icon: Settings, label: 'Settings', path: '/settings' },
  ];

  const handleLogout = async () => {
    try {
      await api.post('/auth/logout');
      router.push('/login');
    } catch (error) {
      console.error('Failed to logout:', error);
    }
  };

  return (
    <div className="w-[220px] h-screen bg-[#09090b] border-r border-[#27272a] flex flex-col shrink-0">
      {/* Logo */}
      <div className="p-4 flex items-center gap-3 border-b border-[#27272a] h-[72px]">
        <img
          src="/logo.png"
          alt="PhishHunt logo"
          className="w-10 h-10 rounded-lg shadow-[0_0_15px_rgba(220,38,38,0.4)] shrink-0"
        />
        <span className="text-xl font-bold text-white whitespace-nowrap tracking-wider">
          PHISH<span className="text-red-500">HUNT</span>
        </span>
      </div>

      {/* Nav items */}
      <div className="flex-1 py-6 flex flex-col gap-1 px-3">
        {menuItems.map((item) => {
          const isActive = pathname === item.path || pathname.startsWith(item.path + '/');
          const Icon = item.icon;

          return (
            <Link key={item.path} href={item.path}>
              <div className={`
                flex items-center gap-3 px-3 py-3 rounded-lg cursor-pointer transition-all duration-200
                ${isActive
                  ? 'bg-red-950/40 text-red-500 border border-red-900/50'
                  : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100'
                }
              `}>
                <Icon className={`w-5 h-5 flex-shrink-0 ${isActive ? 'text-red-500' : ''}`} />
                <span className="font-medium text-sm whitespace-nowrap">{item.label}</span>
              </div>
            </Link>
          );
        })}
      </div>

      {/* Logout */}
      <div className="p-4 border-t border-[#27272a]">
        <button
          onClick={handleLogout}
          className="flex items-center gap-3 px-3 py-3 rounded-lg w-full text-zinc-400 hover:bg-zinc-900 hover:text-red-400 transition-colors"
        >
          <LogOut className="w-5 h-5 flex-shrink-0" />
          <span className="font-medium text-sm whitespace-nowrap">Logout</span>
        </button>
      </div>
    </div>
  );
};

export default Sidebar;
