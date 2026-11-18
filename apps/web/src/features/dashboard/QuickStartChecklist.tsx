import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Circle, X } from 'lucide-react';

interface Step {
  title: string;
  description: string;
  href: string;
  /** Derived from existing data; undefined means we cannot tell, so no tick is shown. */
  done?: boolean;
}

interface QuickStartChecklistProps {
  userId: string;
  isClientUser: boolean;
  /** Asset counts keyed by status, as returned by /inventory/summary. */
  summary: Record<string, number> | undefined;
}

// Dismissal is a per-browser convenience only; the checklist must render fine without storage.
function readDismissed(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeDismissed(key: string): void {
  try {
    window.localStorage.setItem(key, '1');
  } catch {
    // Storage blocked (private window etc.): the checklist simply reappears next visit.
  }
}

function buildSteps(isClientUser: boolean, summary: Record<string, number> | undefined): Step[] {
  const total = summary ? Object.values(summary).reduce((a, b) => a + b, 0) : 0;
  const hasStock = (summary?.in_storage ?? 0) > 0 || (summary?.deployed ?? 0) > 0;

  if (isClientUser) {
    return [
      {
        title: 'See your devices',
        description: 'Open Inventory to see every device we hold for you and its current status.',
        href: '/inventory',
        done: total > 0,
      },
      {
        title: 'Check an inspection result',
        description: 'Open Inspections to see the condition report for a received device.',
        href: '/inspections',
      },
      {
        title: 'Review your activity',
        description: 'The Ledger lists every action taken on your devices, in date order.',
        href: '/ledger',
      },
    ];
  }

  return [
    {
      title: 'Log an expected delivery',
      description: 'Tell the system what is arriving, from which supplier, and when.',
      href: '/inbound',
    },
    {
      title: 'Receive a device against it',
      description: 'When the box arrives, scan or enter each serial number to book it in.',
      href: '/inbound',
      done: total > 0,
    },
    {
      title: 'Inspect the device',
      description: 'Record its condition. Passing the inspection moves it into storage.',
      href: '/inspections',
      done: hasStock,
    },
    {
      title: 'Check the ledger',
      description: 'Every step above posted a priced entry. Open the ledger to see them.',
      href: '/ledger',
    },
  ];
}

/** First-run guide shown on the dashboard until the user dismisses it. */
export function QuickStartChecklist({ userId, isClientUser, summary }: QuickStartChecklistProps) {
  const storageKey = `quick-start-dismissed:${userId}`;
  const [dismissed, setDismissed] = useState(() => readDismissed(storageKey));

  if (dismissed) return null;

  const steps = buildSteps(isClientUser, summary);
  const tracked = steps.filter((s) => s.done !== undefined);
  const doneCount = tracked.filter((s) => s.done).length;

  const handleDismiss = () => {
    writeDismissed(storageKey);
    setDismissed(true);
  };

  return (
    <section
      aria-label="Quick start"
      className="bg-white rounded-xl border border-orange-200 shadow-sm p-5"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Quick start</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            New here? These {steps.length} steps take about ten minutes.
            {tracked.length > 0 && ` ${doneCount} of ${tracked.length} tracked steps complete.`}
          </p>
        </div>
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Dismiss quick start"
          className="text-gray-400 hover:text-gray-600 transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      <ol className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
        {steps.map((step, index) => (
          <li key={step.title}>
            <Link
              to={step.href}
              className="flex gap-3 p-3 rounded-lg border border-gray-200 hover:border-[#E86F2C] hover:bg-orange-50 transition-colors h-full"
            >
              {step.done ? (
                <CheckCircle2 size={18} className="text-emerald-500 flex-shrink-0 mt-0.5" />
              ) : (
                <Circle size={18} className="text-gray-300 flex-shrink-0 mt-0.5" />
              )}
              <div className="min-w-0">
                <div className="text-sm font-medium text-gray-900">
                  {index + 1}. {step.title}
                </div>
                <div className="text-xs text-gray-500 mt-0.5">{step.description}</div>
              </div>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
