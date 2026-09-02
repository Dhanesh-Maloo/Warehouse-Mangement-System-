import { useState } from 'react';
import {
  LayoutDashboard,
  PackagePlus,
  Package,
  ClipboardCheck,
  BookOpen,
  CreditCard,
  Users,
  Building2,
  MapPin,
  UserCheck,
  Truck,
  ArrowDownToLine,
  Trash2,
  CircleDollarSign,
  ShieldCheck,
  ChevronDown,
  Wrench,
  Tag,
  Map,
  Hourglass,
  Ticket,
  type LucideIcon,
} from 'lucide-react';

interface RoleInfo {
  key: string;
  label: string;
  color: string;
  scope: string;
  summary: string;
  canDo: string[];
  cannotDo: string[];
}

const ROLES: RoleInfo[] = [
  {
    key: 'admin',
    label: 'Admin',
    color: 'bg-red-100 text-red-700',
    scope: 'All clients',
    summary: 'Full platform control. The only role that can manage tenants and other users freely.',
    canDo: [
      'Everything, everywhere - every client, every module',
      'Create, edit and deactivate Clients (tenants)',
      'Create and manage any user, including other admins',
      'Create and edit the Rate Card (pricing)',
      'Post ledger corrections',
      'Approve disposal requests',
    ],
    cannotDo: [],
  },
  {
    key: 'manager',
    label: 'Manager',
    color: 'bg-purple-100 text-purple-700',
    scope: 'All clients',
    summary:
      'Day-to-day operational oversight across every client, minus tenant/user administration.',
    canDo: [
      'View and manage assets, inbound, inspections, deployment, retrieval, disposal for every client',
      'Approve disposal requests',
      'Run monthly storage accrual, view billing for any client',
      'Create/edit locations, end users, expected deliveries',
      'Export ledger to CSV',
    ],
    cannotDo: [
      'Create/edit Clients or Users',
      'Create or edit Rate Card entries',
      'Post ledger corrections',
    ],
  },
  {
    key: 'operator',
    label: 'Operator',
    color: 'bg-blue-100 text-blue-700',
    scope: 'All clients',
    summary: 'Warehouse floor staff - receiving, inspecting, packing and dispatching devices.',
    canDo: [
      'Create/update assets, receive deliveries, run inspections',
      'Create and progress deployment, retrieval and disposal requests',
      'Upload asset/inspection documents and photos',
      'View inventory, dashboard and rate card (view-only)',
    ],
    cannotDo: [
      'Approve disposal requests',
      'Manage locations, clients, users, or the rate card',
      'See the ledger or billing pages',
    ],
  },
  {
    key: 'client_user',
    label: 'Client user',
    color: 'bg-gray-100 text-gray-700',
    scope: 'Own client only',
    summary: 'Read-only portal access for a client’s own staff to check on their devices.',
    canDo: [
      'View their own client’s assets, inspections, deployments, retrievals, disposals',
      'View their own client’s dashboard, billing and ledger',
      'View their own client’s end users',
    ],
    cannotDo: ['Create or edit anything', 'See any other client’s data'],
  },
  {
    key: 'editor',
    label: 'Editor',
    color: 'bg-amber-100 text-amber-700',
    scope: 'Own client only',
    summary:
      'A client-side power user who can operate day-to-day work, but never deletes or approves.',
    canDo: [
      'Create/edit assets, inbound deliveries, inspections, deployments, retrievals and disposal requests - for their own client only',
      'Create/edit their own client’s end users',
      'Upload documents and inspection photos',
      'View dashboard, billing, ledger and rate card for their own client',
    ],
    cannotDo: [
      'Delete or deactivate anything',
      'Approve disposal requests',
      'Manage users or the rate card',
      'See any other client’s data',
    ],
  },
  {
    key: 'client_admin',
    label: 'Client admin',
    color: 'bg-teal-100 text-teal-700',
    scope: 'Own client only',
    summary:
      'Everything an Editor can do, plus delete/approve powers and user management - all fenced to one client.',
    canDo: [
      'Everything Editor can do',
      'Deactivate their own client’s end users',
      'Approve → process → complete their own client’s disposal requests',
      'Delete their own client’s uploaded documents',
      'Create/edit/suspend user accounts for their own client (Client user, Editor, or Client admin roles only)',
    ],
    cannotDo: [
      'See or touch any other client’s data',
      'Manage the Client (tenant) record itself, or see the Clients page',
      'Edit the Rate Card (view-only - pricing is shared across every client)',
      'Create Operator/Manager/Admin accounts (blocked to prevent escalating to platform-wide access)',
    ],
  },
];

interface ModuleInfo {
  id: string;
  title: string;
  icon: LucideIcon;
  summary: string;
  steps: string[];
  roles: string;
}

const MODULES: ModuleInfo[] = [
  {
    id: 'dashboard',
    title: 'Dashboard',
    icon: LayoutDashboard,
    summary:
      'The home screen - a snapshot of inventory counts, pending inspections, and (for internal roles) today’s expected deliveries.',
    steps: [
      'Open the app - this is the first page you land on.',
      'The severity/status tiles at the top summarize how many devices are in each stage of the lifecycle.',
      'The pending inspections list flags anything overdue against the business-hours SLA.',
    ],
    roles:
      'Everyone sees a dashboard; client-scoped roles (Client user, Editor, Client admin) only see their own client’s numbers.',
  },
  {
    id: 'inbound',
    title: 'Inbound',
    icon: PackagePlus,
    summary:
      'Log expected deliveries from a client, then receive the physical devices against them to create a Goods Received Note (GRN).',
    steps: [
      'Click "New delivery", pick the client (auto-filled for client-scoped roles), enter the PO reference, expected date, and the line items (category, model, manufacturer, quantity).',
      'When the shipment physically arrives, open the delivery and use "Receive devices" to scan/enter each unit’s serial number - this creates asset records and posts the GRN.',
      'Download the GRN as a PDF from the delivery’s detail page for warehouse records.',
    ],
    roles:
      'Operator/Editor/Client admin can receive devices; only Admin/Manager/Editor/Client admin can log a new expected delivery.',
  },
  {
    id: 'inventory',
    title: 'Inventory',
    icon: Package,
    summary:
      'The full list of every asset (device) in the warehouse, searchable by serial number, model, status, category or client.',
    steps: [
      'Use the search bar or filters to find a device.',
      'Click a row to open the asset’s full timeline - every action ever taken against it, in order.',
      '"Add asset" lets Admin/Manager/Operator/Editor/Client admin manually register a device outside the normal inbound flow.',
      'Edit a device’s condition grade, status or location from its detail page.',
    ],
    roles:
      'Everyone can view (scoped to their own client for client-scoped roles); Admin/Manager/Operator/Editor/Client admin can add or edit.',
  },
  {
    id: 'stock-ageing',
    title: 'Stock Ageing',
    icon: Hourglass,
    summary:
      'Idle stock report - every in-storage asset, grouped by how many days it has sat there uninterrupted (0-7, 8-30, 31-60, 61-90, 90+).',
    steps: [
      'Click a bucket tile to filter the table to just that age range - click again to clear it.',
      'Filter further by client (internal roles) and category.',
      'Click a row to jump to that asset’s full profile.',
      '"Idle since" is when the device most recently entered storage - not when it was first received, if it left and came back.',
    ],
    roles:
      'Everyone can view, scoped to their own client for client-scoped roles; there is nothing to create or edit here.',
  },
  {
    id: 'inspections',
    title: 'Inspections',
    icon: ClipboardCheck,
    summary:
      'Condition assessments performed on a device - inbound (on arrival), outbound (before redeployment), or periodic.',
    steps: [
      'Click "Start inspection", search for the asset by serial number, and choose the inspection type.',
      'Work through the checklist (physical condition, functional tests) and assign a condition grade.',
      'Attach photos as evidence, then "Complete" the inspection - or "Cancel" if it was started in error.',
    ],
    roles:
      'Client user only views; Admin/Manager/Operator/Editor/Client admin can start, complete, cancel and upload photos - all scoped to their own client for Editor/Client admin.',
  },
  {
    id: 'deployment',
    title: 'Deployment',
    icon: Truck,
    summary: 'Pick, pack and dispatch an in-storage device to an end user at a delivery address.',
    steps: [
      'Click "New Deployment Order", choose the client, the in-storage asset, and the end user (or create one inline).',
      'Fill in the delivery address, bundle type (standard vs. full prep/labeling/repacking), and courier zone.',
      'As the order progresses, update its status, courier zone, and tracking number from the list.',
      'Once an order is "delivered", download a Delivery Challan (DC) PDF from the list - proof of delivery with the asset, client, contact, tracking and ticket details.',
    ],
    roles:
      'Client user only views; Admin/Manager/Operator/Editor/Client admin can create and progress orders - scoped to their own client for Editor/Client admin.',
  },
  {
    id: 'retrieval',
    title: 'Retrieval',
    icon: ArrowDownToLine,
    summary:
      'Bring a deployed device back into the warehouse - standard pickup, or full-cycle (retrieve + redeploy).',
    steps: [
      'Click "New Retrieval Request", pick the client and the deployed asset, then fill in pickup address and bundle type.',
      'Check "Requires data wipe" if the client has confirmed the device needs wiping - this is optional and decided per retrieval, not automatic.',
      'Owner is set automatically to whoever is logged in and creates the request - it is not a picker.',
      'Track status from pending → initiated → in transit → received → completed.',
      'A diagnostic Inspection is always auto-created the moment a device is marked "received" - this cannot be skipped, since Esevel needs a diagnostic report on every retrieval.',
      'Once a request is "received" or "completed", download a Retrieval Confirmation PDF (asset details, owner, tickets, tracking, diagnostic result) from the list.',
    ],
    roles:
      'Client user only views; Admin/Manager/Operator/Editor/Client admin can create and progress requests - scoped to their own client for Editor/Client admin.',
  },
  {
    id: 'disposal',
    title: 'Disposal',
    icon: Trash2,
    summary:
      'End-of-life handling - non-certified wipe, certified data destruction, or full ITAD (IT Asset Disposition).',
    steps: [
      'Click "New Disposal Request", pick the client, the in-storage asset, and the disposal type: Non-Certified, Certified Data Destruction, or Retrieval + ITAD Bundled.',
      'For Non-Certified or ITAD Bundled requests, optionally add the Certification add-on (₹550 + GST) for a destruction certificate - Certified Data Destruction already includes certification, so the add-on isn’t offered on that type.',
      'A Manager, Admin, or the owning client’s Client admin approves the request.',
      'Once approved, mark it "in progress" and then "complete" - completing it marks the asset disposed permanently.',
      'Once a request is "completed", download a Certificate of Disposal PDF from the list - disposal type, certification status, approver and the disposed asset’s details.',
    ],
    roles:
      'Client user only views; Admin/Manager/Operator/Editor/Client admin can file requests and progress them; only Admin/Manager/Client admin (own client) can approve.',
  },
  {
    id: 'repair',
    title: 'Repair',
    icon: Wrench,
    summary:
      'Send an in-storage device to an external service center for repair and track its return, with an SLA target that adapts to how the repair is being handled.',
    steps: [
      'Click "New Repair Request", pick the client (auto-filled for client-scoped roles), the in-storage asset, and the service center name.',
      'Choose the repair type: "OEM / Warranty" (handled by the manufacturer), or "In-House" - which then also asks for a category, Software or Hardware.',
      'Optionally add an estimate cost and notes, then submit.',
      'The SLA target date is set automatically based on the repair type: In-House Software defaults to 3 business days (Mon-Sat, 09:00-18:00 IST, excluding holidays); OEM/Warranty and In-House Hardware have no fixed default since they depend on the OEM/parts timeline - enter or revise the target date once it becomes known.',
      'A request past its SLA target is flagged "Overdue" wherever it’s listed. Requests with no target set yet are never flagged.',
      'Progress the request from pending → sent → in repair → returned using the status dropdown. From "returned", completing it requires uploading the service center’s own Delivery Challan (DC) as proof.',
      'Once a request is "completed", download a system-generated Repair Report PDF from the list - service center, repair type, cost estimate and the repaired asset’s details (separate from the service center’s uploaded DC).',
    ],
    roles:
      'Client user only views; Admin/Manager/Operator/Editor/Client admin can file and progress requests, and revise the SLA target - scoped to their own client for Editor/Client admin.',
  },
  {
    id: 'resale',
    title: 'Resale',
    icon: Tag,
    summary: 'List an in-storage device for resale and record the sale once it’s sold.',
    steps: [
      'Click "New Resale Listing", pick the client (auto-filled for client-scoped roles), the in-storage asset, and an optional listed price.',
      'Mark a listing "Sold" and optionally record the sold price, or "Cancel" it.',
      'Marking a listing sold moves the underlying asset to a "Sold" status - it drops out of Inventory’s normal in-storage/deployed views but its full history is kept.',
    ],
    roles:
      'Client user only views; Admin/Manager/Operator/Editor/Client admin can create listings and update status - scoped to their own client for Editor/Client admin.',
  },
  {
    id: 'locations',
    title: 'Locations',
    icon: MapPin,
    summary:
      'Warehouse zones and bins (e.g. Zone A, Bin 12) used to physically place stored assets. Shared infrastructure, not tied to any one client.',
    steps: [
      'Admin/Manager can add a new location by zone code + bin code.',
      'A location can’t be deleted while it’s still holding assets - move the assets out first.',
      'Use the "Move" action on an asset’s detail page to relocate it between locations.',
    ],
    roles: 'Everyone can view; only Admin/Manager can create, edit or delete locations.',
  },
  {
    id: 'end-users',
    title: 'End Users',
    icon: UserCheck,
    summary:
      'The people at a client company who actually receive deployed devices - not platform login accounts.',
    steps: [
      'Click "Add End User" and fill in name, employee ID, email, phone and city.',
      'End users show up in the picker when creating a Deployment Order.',
      'Deactivate an end user who has left the company - their history is kept, they’re just hidden from new deployments.',
    ],
    roles:
      'Client user only views their own client’s end users; Admin/Manager/Editor/Client admin can add/edit; only Admin or the owning client’s Client admin can deactivate.',
  },
  {
    id: 'billing',
    title: 'Billing',
    icon: CircleDollarSign,
    summary:
      'Monthly storage accrual and transaction history for a client - how many devices are stored, projected monthly cost, and whether the minimum commitment is met.',
    steps: [
      'Pick a client (auto-selected for client-scoped roles) to see their current storage summary and projected cost.',
      'Review the transaction list for a date range - every priced event that hit the ledger.',
      '"Run accrual" (Admin only) manually triggers the monthly storage billing job across all clients.',
    ],
    roles:
      'Client user, Editor and Client admin see only their own client; Admin/Manager see and select any client; only Admin can run accrual.',
  },
  {
    id: 'ledger',
    title: 'Ledger',
    icon: BookOpen,
    summary:
      'The append-only record of every priced event in the system. Nothing is ever edited or deleted here - mistakes are fixed with a correction row.',
    steps: [
      'Filter by client, asset, event type or date range.',
      'Export the filtered view to CSV (Admin/Manager).',
      'If an event was posted in error, Admin can post a correction - this adds a new negative-amount row referencing the original; the original is never touched.',
    ],
    roles:
      'Client user, Editor and Client admin see only their own client’s entries; Admin/Manager see everything; only Admin can post corrections.',
  },
  {
    id: 'rate-card',
    title: 'Rate Card',
    icon: CreditCard,
    summary:
      'The price list for every billable action (receiving, inspection, deployment, courier, storage, disposal). One shared rate card applies to every client.',
    steps: [
      'View the currently effective rate for each billable code.',
      'Admin adds a new rate by creating a new version with a future "effective from" date - the old rate keeps applying to anything that already happened.',
    ],
    roles:
      'Admin/Manager/Operator/Editor/Client admin can view current pricing; only Admin can create new rates (this is deliberately locked down since it affects every client’s bill).',
  },
  {
    id: 'ticket-lookup',
    title: 'Ticket Lookup',
    icon: Ticket,
    summary:
      'Search by an iValue or client ticket number to see everything that happened under it, across every module.',
    steps: [
      'Type a ticket number and search - it checks Inbound, Retrieval, Inspections, Deployment, Disposal and Repair all at once.',
      'If the same ticket number was used on more than one module (e.g. an Inbound delivery and a later Retrieval), every match shows up as its own row, tagged with which module it came from - nothing is merged or hidden.',
      'Each row links straight to that record, and shows its ledger charges and a combined total at the bottom.',
    ],
    roles: 'Everyone can use it, scoped to their own client for client-scoped roles.',
  },
  {
    id: 'clients',
    title: 'Clients',
    icon: Building2,
    summary:
      'The tenants of this platform - the companies whose devices are warehoused here (e.g. Esevel). Admin-only.',
    steps: [
      'Click "New client" to onboard a company - name, slug, GSTIN, billing contact.',
      'Edit a client’s contact details or GSTIN from the pencil icon.',
      'Deactivate a client that’s no longer active - this is a soft action, all of their history (assets, ledger, users) is kept.',
    ],
    roles:
      'Admin only - no other role can see this page, including Client admin, since it’s tenant management, not client data.',
  },
  {
    id: 'users',
    title: 'Users',
    icon: Users,
    summary:
      'Platform login accounts and their roles. This is where you create every role covered in the guide above.',
    steps: [
      'Click "New user", fill in name/email/password, and pick a Role.',
      'If the role is client-scoped (Client user, Editor, Client admin), a Client picker appears - pick which company this account belongs to.',
      'Suspend/Reactivate toggles a user’s access without deleting their account or history.',
    ],
    roles:
      'Admin manages every user, every role. A Client admin can also reach this page, but only sees and manages accounts belonging to their own client, and can only assign Client user / Editor / Client admin roles.',
  },
  {
    id: 'audit-log',
    title: 'Audit Log',
    icon: ShieldCheck,
    summary:
      'A record of who changed what and when, across the whole platform - user creation, status changes, client edits, disposal approvals, and more.',
    steps: [
      'Filter by entity type, action, or date range to investigate a specific change.',
      'Expand a row to see the before/after values of what changed.',
    ],
    roles: 'Admin and Manager only.',
  },
  {
    id: 'rural-pincodes',
    title: 'Rural Pincodes',
    icon: Map,
    summary:
      'Maintain the list of pincodes that always resolve to the "Rural" courier zone for Deployment and Retrieval orders, overriding the automatic intra-state/inter-state comparison.',
    steps: [
      'Enter a 6-digit pincode and an optional note, then click "Add".',
      'Remove a pincode from the list with the trash icon - it reverts to automatic zone resolution.',
    ],
    roles:
      'Admin/Manager only - both list, add and remove entries; no other role can see this page.',
  },
];

function RoleCard({ role }: { role: RoleInfo }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left hover:bg-gray-50/50 transition-colors"
      >
        <div className="flex items-center gap-3 min-w-0">
          <span
            className={`px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${role.color}`}
          >
            {role.label}
          </span>
          <span className="text-xs text-gray-400 whitespace-nowrap">{role.scope}</span>
          <span className="text-sm text-gray-600 truncate hidden sm:block">{role.summary}</span>
        </div>
        <ChevronDown
          size={18}
          className={`text-gray-400 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div className="px-5 pb-5 grid grid-cols-1 sm:grid-cols-2 gap-4 border-t border-gray-100 pt-4">
          <div>
            <div className="text-xs font-semibold text-emerald-700 uppercase tracking-wide mb-2">
              Can do
            </div>
            <ul className="space-y-1.5">
              {role.canDo.map((item) => (
                <li key={item} className="text-sm text-gray-600 flex gap-2">
                  <span className="text-emerald-500 flex-shrink-0">+</span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="text-xs font-semibold text-red-700 uppercase tracking-wide mb-2">
              Cannot do
            </div>
            {role.cannotDo.length === 0 ? (
              <p className="text-sm text-gray-400">Nothing - full access.</p>
            ) : (
              <ul className="space-y-1.5">
                {role.cannotDo.map((item) => (
                  <li key={item} className="text-sm text-gray-600 flex gap-2">
                    <span className="text-red-500 flex-shrink-0">–</span>
                    {item}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ModuleCard({ mod }: { mod: ModuleInfo }) {
  const Icon = mod.icon;
  return (
    <div
      id={mod.id}
      className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 scroll-mt-6"
    >
      <div className="flex items-start gap-3 mb-4">
        <div className="p-2 bg-[#1A2B3C]/5 rounded-lg flex-shrink-0">
          <Icon size={18} className="text-[#1A2B3C]" />
        </div>
        <div>
          <h3 className="text-base font-semibold text-gray-900">{mod.title}</h3>
          <p className="text-sm text-gray-500 mt-0.5">{mod.summary}</p>
        </div>
      </div>
      <ol className="space-y-2 mb-4">
        {mod.steps.map((step, i) => (
          <li key={step} className="text-sm text-gray-600 flex gap-3">
            <span className="flex-shrink-0 w-5 h-5 rounded-full bg-[#E86F2C]/10 text-[#E86F2C] text-xs font-semibold flex items-center justify-center mt-0.5">
              {i + 1}
            </span>
            {step}
          </li>
        ))}
      </ol>
      <div className="bg-gray-50 rounded-lg px-4 py-3">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
          Who can use this
        </p>
        <p className="text-sm text-gray-600">{mod.roles}</p>
      </div>
    </div>
  );
}

export function HelpPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">User Manual</h1>
        <p className="text-sm text-gray-500 mt-1">
          A complete guide to every module and every role in IValue WMS.
        </p>
      </div>

      {/* Table of contents */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Jump to</p>
        <div className="flex flex-wrap gap-2">
          <a
            href="#roles"
            className="text-xs font-medium px-3 py-1.5 rounded-lg bg-[#1A2B3C] text-white hover:bg-[#1A2B3C]/90 transition-colors"
          >
            Roles &amp; Permissions
          </a>
          {MODULES.map((m) => (
            <a
              key={m.id}
              href={`#${m.id}`}
              className="text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
            >
              {m.title}
            </a>
          ))}
        </div>
      </div>

      {/* Roles & Permissions */}
      <div id="roles" className="space-y-3 scroll-mt-6">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Roles &amp; Permissions</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Click a role to see exactly what it can and can’t do. &ldquo;Own client only&rdquo;
            roles never see or affect any other client’s data, no matter what they try.
          </p>
        </div>
        <div className="space-y-2">
          {ROLES.map((role) => (
            <RoleCard key={role.key} role={role} />
          ))}
        </div>
      </div>

      {/* Modules */}
      <div className="space-y-3">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Modules</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            What each part of the app does, how to use it, and who can use it.
          </p>
        </div>
        <div className="space-y-4">
          {MODULES.map((mod) => (
            <ModuleCard key={mod.id} mod={mod} />
          ))}
        </div>
      </div>
    </div>
  );
}
