import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogClose, DialogContent, DialogTitle,
} from "@/components/ui/dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import {
  Users, MapPin, X, Map as MapIcon,
} from "lucide-react";
import { getRealFranchiseName } from "@/data/franchise-real-names";
import type { EmployeeLocation, ClientLocation } from "@shared/schema";

import {
  COMPANY_TIME_BLOCKS,
  getColorClass,
  isFullyAvailableInTimeBlock,
  type EmployeeAvailabilityInfo,
  type BDMatrixCell,
  type BDMatrixProps,
} from "@/utils/bd-matrix-utils";

import { CareProMap } from "@/components/bd-matrix/CareProMap";
import { ClientEnquiryMatcher } from "@/components/bd-matrix/ClientEnquiryMatcher";
import { BDMatrixTable } from "@/components/bd-matrix/BDMatrixTable";
import { useBranch } from "@/contexts/BranchContext";
import { toAbsoluteUrl } from "@/lib/queryClient";

export default function BDMatrix({ data, weekStartDate }: BDMatrixProps) {
  const [selectedTimeBlocks, setSelectedTimeBlocks] = useState<Set<string>>(new Set());
  const { branches, isLoadingBranches, selectedBranch } = useBranch();

  // Workforce & Client Map spans every franchise the user can see, not just
  // the currently selected branch, so the Sur Group team can compare
  // territories without switching branches.
  const branchIds = useMemo(() => branches.map(b => b.id).join(','), [branches]);
  const { data: locationsData, refetch: refetchLocations, isFetching: isFetchingLocations } = useQuery<{ employees: EmployeeLocation[]; clients: ClientLocation[] }>({
    queryKey: ['/api/locations/multi', branchIds],
    queryFn: async () => {
      const res = await fetch(toAbsoluteUrl(`/api/locations/multi?branchIds=${encodeURIComponent(branchIds)}`), { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch locations');
      return res.json();
    },
    enabled: !isLoadingBranches && branches.length > 0,
  });
  const locations = locationsData?.employees ?? [];

  const matrixData = useMemo(() => {
    if (!data?.employeeSummaryByDate) return null;
    const dates = Object.keys(data.employeeSummaryByDate).sort();
    const matrix: Record<string, Record<string, BDMatrixCell>> = {};

    for (const date of dates) {
      matrix[date] = {};
      for (const timeBlock of COMPANY_TIME_BLOCKS) {
        matrix[date][timeBlock.label] = { count: 0, employees: [], colorClass: getColorClass(0) };
      }
    }
    for (const date of dates) {
      const employees = data.employeeSummaryByDate[date] || [];
      for (const employee of employees) {
        for (const timeBlock of COMPANY_TIME_BLOCKS) {
          if (isFullyAvailableInTimeBlock(employee.freeWindows, timeBlock)) {
            const cell = matrix[date][timeBlock.label];
            cell.count++;
            cell.employees.push({
              name: employee.employeeName,
              gender: employee.gender,
              transportMode: employee.transportMode,
              freeWindows: employee.freeWindows,
              scheduledHours: employee.scheduledHours,
              cancelledVisits: employee.cancelledVisits,
            });
            cell.colorClass = getColorClass(cell.count);
          }
        }
      }
    }
    return { dates, matrix };
  }, [data]);

  const filteredMatrixData = useMemo(() => {
    if (!matrixData || selectedTimeBlocks.size === 0) return null;
    const { dates, matrix } = matrixData;
    const filteredMatrix: Record<string, BDMatrixCell> = {};
    const selectedArray = Array.from(selectedTimeBlocks);

    for (const date of dates) {
      const available = new Map<string, EmployeeAvailabilityInfo>();
      const firstBlock = matrix[date][selectedArray[0]]?.employees || [];
      for (const emp of firstBlock) {
        const inAll = selectedArray.slice(1).every(block =>
          matrix[date][block]?.employees.some(e => e.name === emp.name)
        );
        if (inAll) available.set(emp.name, emp);
      }
      const employees = Array.from(available.values());
      filteredMatrix[date] = { count: employees.length, employees, colorClass: getColorClass(employees.length) };
    }
    return { dates, filteredMatrix };
  }, [matrixData, selectedTimeBlocks]);

  const handleTimeBlockToggle = (label: string, checked: boolean) => {
    const next = new Set(selectedTimeBlocks);
    if (checked) next.add(label); else next.delete(label);
    setSelectedTimeBlocks(next);
  };

  const handleSelectAll = () => setSelectedTimeBlocks(new Set(COMPANY_TIME_BLOCKS.map(tb => tb.label)));
  const handleSelectNone = () => setSelectedTimeBlocks(new Set());

  if (!data) {
    return (
      <div className="p-8 text-center">
        <Users className="w-16 h-16 mx-auto text-gray-400 mb-4" />
        <h3 className="text-lg font-medium text-gray-500 mb-2">No Data Available</h3>
        <p className="text-gray-400">Upload and process your Excel files to see the BD availability matrix.</p>
      </div>
    );
  }
  if (!matrixData) {
    return (
      <div className="p-8 text-center">
        <Users className="w-16 h-16 mx-auto text-gray-400 mb-4" />
        <h3 className="text-lg font-medium text-gray-500 mb-2">Processing Data</h3>
        <p className="text-gray-400">Please wait while we process your availability data...</p>
      </div>
    );
  }

  const { dates, matrix } = matrixData;

  return (
    <div className="h-full flex flex-col gap-4 p-4">
      {/* Header */}
      <Card className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 shadow-sm shrink-0">
        <CardHeader className="bg-[#f8f9ff] dark:bg-gray-900/50 rounded-t-lg pt-[8px] pb-[8px]">
          <div className="flex items-center justify-between">
            <CardTitle className="text-xl font-semibold text-[#5d51d5] flex items-center gap-3">
              <Users className="w-6 h-6 text-[#5d51d5]" />
              BD Availability Matrix
            </CardTitle>
            <div className="flex items-center gap-3">
              <MapDialogWrapper
                locations={locations}
                clients={locationsData?.clients ?? []}
                branches={branches}
                selectedBranchId={selectedBranch?.id ?? null}
                onRefresh={() => refetchLocations()}
                isRefreshing={isFetchingLocations}
              />
              <ClientEnquiryMatcher weekStartDate={weekStartDate} />
            </div>
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Quick view of staff availability across standard time blocks for business development decisions
          </p>
        </CardHeader>
      </Card>

      <BDMatrixTable
        dates={dates}
        matrix={matrix}
        filteredMatrixData={filteredMatrixData}
        selectedTimeBlocks={selectedTimeBlocks}
        handleTimeBlockToggle={handleTimeBlockToggle}
        handleSelectAll={handleSelectAll}
        handleSelectNone={handleSelectNone}
      />
    </div>
  );
}

// Branch colour palette — mirrors BRANCH_COLORS in CareProMap
const BRANCH_COLORS: Record<string, string> = {
  'aberdeen':          '#ef4444',
  'south-ayrshire':    '#f97316',
  'east-lothian':      '#eab308',
  'glasgow-north':     '#22c55e',
  'glasgow-south':     '#14b8a6',
  'north-lanarkshire': '#3b82f6',
  'perthshire':        '#8b5cf6',
  'scottish-borders':  '#ec4899',
  'stirling-falkirk':  '#f59e0b',
  'west-fife-kinross': '#06b6d4',
};

function MapDialogWrapper({
  locations,
  clients,
  branches,
  selectedBranchId,
  onRefresh,
  isRefreshing,
}: {
  locations: EmployeeLocation[];
  clients: ClientLocation[];
  branches: { id: string; name: string; displayName: string }[];
  selectedBranchId: string | null;
  onRefresh: () => void;
  isRefreshing: boolean;
}) {
  const [open, setOpen] = useState(false);

  const activeBranch  = branches.find(b => b.id === selectedBranchId) ?? null;
  const activeSlug    = activeBranch?.name ?? '';
  const activeColor   = BRANCH_COLORS[activeSlug] ?? '#5d51d5';
  const activeRealName = activeBranch
    ? getRealFranchiseName(activeBranch.name, activeBranch.displayName)
    : 'All Franchises';

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="gap-2 font-bold rounded-xl border-blue-200 hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-all"
        onClick={() => setOpen(true)}
      >
        <MapIcon className="w-4 h-4 text-blue-600" />
        View Map
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-screen h-screen max-w-none max-h-none overflow-hidden flex flex-col p-0 gap-0 border-none shadow-none rounded-none bg-transparent">
          {/* Accessible title — visually hidden since the header card serves the same purpose */}
          <VisuallyHidden>
            <DialogTitle>Workforce & Client Map — {activeRealName}</DialogTitle>
          </VisuallyHidden>

          {/* Close button */}
          <DialogClose asChild>
            <button
              className="absolute top-5 right-5 z-[1001] w-9 h-9 rounded-full bg-white/95 hover:bg-white shadow-xl border border-gray-200 flex items-center justify-center transition-all duration-200 hover:scale-105"
              title="Close map"
            >
              <X className="w-4 h-4 text-gray-600" />
            </button>
          </DialogClose>

          {/* Header card — top-left */}
          <div className="absolute top-5 left-5 z-[1000] pointer-events-auto">
            <div className="flex items-center gap-3 bg-white/97 backdrop-blur-sm rounded-2xl shadow-xl border border-gray-100 px-4 py-3">
              {/* Franchise colour indicator */}
              <div
                className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: `${activeColor}18`, border: `2px solid ${activeColor}` }}
              >
                <MapPin className="w-4 h-4" style={{ color: activeColor }} />
              </div>
              <div>
                <h2 className="text-sm font-bold text-gray-900 leading-tight">Workforce & Client Map</h2>
                <p className="text-[10px] font-semibold mt-0.5" style={{ color: activeColor }}>
                  {activeRealName}
                </p>
              </div>
            </div>
          </div>

          {/* Map */}
          <div className="flex-1 relative overflow-hidden" style={{ background: '#e8edf2' }}>
            <CareProMap
              locations={locations}
              clients={clients}
              branches={branches}
              selectedBranchId={selectedBranchId}
              onRefresh={onRefresh}
              isRefreshing={isRefreshing}
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
