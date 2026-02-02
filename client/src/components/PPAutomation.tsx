import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Calendar, Download, RefreshCw, Bot, CheckCircle, Clock, AlertTriangle, Key, ExternalLink } from 'lucide-react';
import { apiRequest, queryClient } from '@/lib/queryClient';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface PPBranch {
  name: string;
  franchiseName: string;
}

interface PPExportResult {
  success: boolean;
  message: string;
  files?: {
    visits?: string;
    caregivers?: string;
    availability?: string;
  };
  errors?: string[];
}

interface PPFile {
  id: string;
  name: string;
  size: number;
  downloadedAt: string;
  exportType: 'visits' | 'caregivers' | 'availability' | 'unknown';
}

interface PPAutomationStatus {
  hasRecentDownloads: boolean;
  files: PPFile[];
}

interface PPAutomationProps {
  branchId?: string;
  branchName?: string;
  onProcessComplete?: () => void;
}

function getWeekDates(weeksOffset: number = 0): { start: string; end: string; label: string } {
  const today = new Date();
  const dayOfWeek = today.getDay();
  const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  
  const monday = new Date(today);
  monday.setDate(today.getDate() - daysToMonday + (weeksOffset * 7));
  
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  
  const formatDate = (d: Date) => d.toISOString().split('T')[0];
  const formatLabel = (d: Date) => d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
  
  return {
    start: formatDate(monday),
    end: formatDate(sunday),
    label: `${formatLabel(monday)} - ${formatLabel(sunday)}`,
  };
}

const weekOptions = [
  { ...getWeekDates(-2), id: '-2', name: '2 weeks ago' },
  { ...getWeekDates(-1), id: '-1', name: 'Last week' },
  { ...getWeekDates(0), id: '0', name: 'This week' },
  { ...getWeekDates(1), id: '1', name: 'Next week' },
  { ...getWeekDates(2), id: '2', name: '2 weeks ahead' },
];

export function PPSyncButton({ branchId, branchName, onProcessComplete }: PPAutomationProps) {
  const [open, setOpen] = useState(false);
  
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button 
          variant="outline" 
          size="sm"
          className="gap-2 border-purple-200 hover:border-purple-400 hover:bg-purple-50 dark:border-purple-800 dark:hover:border-purple-600 dark:hover:bg-purple-900/20"
        >
          <Bot className="w-4 h-4 text-purple-600 dark:text-purple-400" />
          <span className="hidden sm:inline">Sync from PP</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-purple-100 dark:bg-purple-900 flex items-center justify-center">
              <Bot className="w-4 h-4 text-purple-600 dark:text-purple-400" />
            </div>
            <span>Sync from People Planner</span>
          </DialogTitle>
          <DialogDescription>
            Download and process data directly from People Planner for the selected branch.
          </DialogDescription>
        </DialogHeader>
        <PPAutomationContent 
          branchId={branchId}
          branchName={branchName} 
          onProcessComplete={() => {
            onProcessComplete?.();
            setOpen(false);
          }} 
        />
      </DialogContent>
    </Dialog>
  );
}

function PPAutomationContent({ branchId, branchName, onProcessComplete }: { branchId?: string; branchName?: string; onProcessComplete?: () => void }) {
  const [selectedBranch, setSelectedBranch] = useState<string>(branchName || '');
  const [selectedWeek, setSelectedWeek] = useState<string>('0');
  const { toast } = useToast();

  const { data: branches, isLoading: loadingBranches } = useQuery<PPBranch[]>({
    queryKey: ['/api/pp-automation/branches'],
  });

  const { data: allBranches } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['/api/branches'],
  });

  useEffect(() => {
    if (branchName) {
      setSelectedBranch(branchName);
    } else if (branchId && allBranches && branches) {
      const matchedBranch = allBranches.find(b => b.id === branchId);
      if (matchedBranch) {
        const ppBranch = branches.find(b => b.name === matchedBranch.name);
        if (ppBranch) {
          setSelectedBranch(ppBranch.name);
        }
      }
    }
  }, [branchId, branchName, allBranches, branches]);

  const { data: status, refetch: refetchStatus } = useQuery<PPAutomationStatus>({
    queryKey: ['/api/pp-automation/status'],
  });

  const exportMutation = useMutation({
    mutationFn: async ({ branchName, weekStartDate, weekEndDate }: { branchName: string; weekStartDate: string; weekEndDate: string }) => {
      const response = await apiRequest('POST', '/api/pp-automation/export', { branchName, weekStartDate, weekEndDate });
      return await response.json() as PPExportResult;
    },
    onSuccess: (data) => {
      if (data.success) {
        toast({
          title: 'Download Complete',
          description: 'All files downloaded from People Planner. Click "Process & Load" to update the dashboard.',
        });
      } else {
        toast({
          title: 'Partial Success',
          description: `Some exports failed: ${data.errors?.join(', ')}`,
          variant: 'destructive',
        });
      }
      refetchStatus();
    },
    onError: (error: Error) => {
      toast({
        title: 'Download Failed',
        description: error.message || 'Failed to download files from People Planner',
        variant: 'destructive',
      });
    },
  });

  const processMutation = useMutation({
    mutationFn: async ({ visitsFileId, caregiversFileId, availabilityFileId }: { visitsFileId: string; caregiversFileId: string; availabilityFileId: string }) => {
      const response = await apiRequest('POST', '/api/pp-automation/process', { visitsFileId, caregiversFileId, availabilityFileId });
      return await response.json();
    },
    onSuccess: () => {
      toast({
        title: 'Data Loaded',
        description: 'Dashboard has been updated with the latest data from People Planner.',
      });
      queryClient.invalidateQueries({ queryKey: ['/api/capacity'] });
      refetchStatus();
      onProcessComplete?.();
    },
    onError: (error: Error) => {
      toast({
        title: 'Processing Failed',
        description: error.message || 'Failed to process downloaded files',
        variant: 'destructive',
      });
    },
  });

  const handleExport = () => {
    if (!selectedBranch) {
      toast({
        title: 'Select Branch',
        description: 'Please select a branch to sync data for.',
        variant: 'destructive',
      });
      return;
    }

    const week = weekOptions.find(w => w.id === selectedWeek);
    if (!week) return;

    exportMutation.mutate({
      branchName: selectedBranch,
      weekStartDate: week.start,
      weekEndDate: week.end,
    });
  };

  const selectedWeekData = weekOptions.find(w => w.id === selectedWeek);
  const matchedBranch = branches?.find(b => b.name === selectedBranch);

  const recentFiles = status?.files?.slice(0, 6) || [];
  const visitsFile = recentFiles.find(f => f.exportType === 'visits');
  const caregiversFile = recentFiles.find(f => f.exportType === 'caregivers');
  const availabilityFile = recentFiles.find(f => f.exportType === 'availability');
  const canProcess = visitsFile && caregiversFile && availabilityFile;

  return (
    <div className="space-y-4">
      {/* Information Box about Browser Limitation */}
      <div className="p-4 rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-900/20">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
          <div className="space-y-1">
            <p className="font-medium text-blue-800 dark:text-blue-200">Manual Export Required</p>
            <p className="text-sm text-blue-700 dark:text-blue-300">
              People Planner requires a real browser for login. Please export the following files manually and upload them below:
            </p>
            <ul className="text-xs text-blue-600 dark:text-blue-400 list-disc ml-4 mt-2 space-y-1">
              <li><strong>Availability Export.xlsx</strong> (CAREGiver Availability)</li>
              <li><strong>Care Pro Guaranteed Hours.xlsx</strong> (Visits)</li>
              <li><strong>CG Data Export.xlsx</strong> (Staff Details)</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Step 1: Select Branch */}
      <div className="space-y-2">
        <Label className="text-sm font-medium flex items-center gap-2">
          <span className="w-5 h-5 rounded-full bg-purple-100 dark:bg-purple-900 flex items-center justify-center text-xs font-bold text-purple-600">1</span>
          Select Branch
        </Label>
        <Select value={selectedBranch} onValueChange={setSelectedBranch}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder={loadingBranches ? "Loading branches..." : "Choose a branch"} />
          </SelectTrigger>
          <SelectContent>
            {branches?.map((branch) => (
              <SelectItem key={branch.name} value={branch.name}>
                {branch.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {matchedBranch && (
          <p className="text-xs text-muted-foreground">
            Current context: <strong>{matchedBranch.franchiseName}</strong>
          </p>
        )}
      </div>

      {/* Manual Upload Section */}
      <div className="space-y-2 pt-2 border-t">
        <Label className="text-sm font-medium flex items-center gap-2">
          <span className="w-5 h-5 rounded-full bg-purple-100 dark:bg-purple-900 flex items-center justify-center text-xs font-bold text-purple-600">2</span>
          Upload Exported Files
        </Label>
        <p className="text-xs text-muted-foreground mb-2">
          Upload the files you exported from People Planner to process them.
        </p>
        <Button 
          variant="outline" 
          className="w-full"
          onClick={() => window.location.href = '/'}
        >
          Go to Manual Upload
        </Button>
      </div>
    </div>
  );
}

export function PPAutomation() {
  return (
    <div className="p-6 rounded-xl border bg-card">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-lg bg-purple-100 dark:bg-purple-900 flex items-center justify-center">
          <Bot className="w-5 h-5 text-purple-600 dark:text-purple-400" />
        </div>
        <div>
          <h3 className="font-semibold">Import from People Planner</h3>
          <p className="text-sm text-muted-foreground">Export files manually, then upload to process</p>
        </div>
      </div>
      <PPAutomationContent />
    </div>
  );
}
