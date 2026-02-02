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
      {/* Step 1: Credentials Check */}
      <div className="p-4 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20">
        <div className="flex items-start gap-3">
          <Key className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
          <div className="space-y-2 flex-1">
            <p className="font-medium text-amber-800 dark:text-amber-200">Setup Required</p>
            <p className="text-sm text-amber-700 dark:text-amber-300">
              To use this feature, add your People Planner login details to your project's Secrets:
            </p>
            <ul className="text-sm text-amber-700 dark:text-amber-300 list-disc ml-4 space-y-1">
              <li><code className="bg-amber-100 dark:bg-amber-800 px-1 rounded">PP_CLIENT_ID</code> - Your client ID (e.g., CARE123)</li>
              <li><code className="bg-amber-100 dark:bg-amber-800 px-1 rounded">PP_USERNAME</code> - Your login email</li>
              <li><code className="bg-amber-100 dark:bg-amber-800 px-1 rounded">PP_PASSWORD</code> - Your password</li>
            </ul>
            <p className="text-xs text-amber-600 dark:text-amber-400 mt-2">
              Find these in the Secrets tab (lock icon) in your Replit project sidebar.
            </p>
          </div>
        </div>
      </div>

      {/* Step 2: Select Branch */}
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
            Will sync from: <strong>{matchedBranch.franchiseName}</strong> in People Planner
          </p>
        )}
      </div>

      {/* Step 3: Select Week */}
      <div className="space-y-2">
        <Label className="text-sm font-medium flex items-center gap-2">
          <span className="w-5 h-5 rounded-full bg-purple-100 dark:bg-purple-900 flex items-center justify-center text-xs font-bold text-purple-600">2</span>
          Select Week
        </Label>
        <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
          {weekOptions.map((week) => (
            <button
              key={week.id}
              onClick={() => setSelectedWeek(week.id)}
              className={`p-2 rounded-lg border text-center transition-all ${
                selectedWeek === week.id
                  ? 'border-purple-500 bg-purple-50 dark:bg-purple-900/30 ring-1 ring-purple-500'
                  : 'border-gray-200 dark:border-gray-700 hover:border-purple-300'
              }`}
            >
              <div className="text-xs font-medium">{week.name}</div>
              <div className="text-[10px] text-muted-foreground">{week.label}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Step 4: Download Button */}
      <div className="space-y-2">
        <Label className="text-sm font-medium flex items-center gap-2">
          <span className="w-5 h-5 rounded-full bg-purple-100 dark:bg-purple-900 flex items-center justify-center text-xs font-bold text-purple-600">3</span>
          Download from People Planner
        </Label>
        <Button
          onClick={handleExport}
          disabled={!selectedBranch || exportMutation.isPending}
          className="w-full bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white"
        >
          {exportMutation.isPending ? (
            <>
              <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
              Downloading... (1-2 minutes)
            </>
          ) : (
            <>
              <Download className="w-4 h-4 mr-2" />
              Download Data
            </>
          )}
        </Button>
      </div>

      {/* Progress indicator when downloading */}
      {exportMutation.isPending && (
        <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg animate-pulse">
          <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400">
            <RefreshCw className="w-4 h-4 animate-spin" />
            <span className="text-sm font-medium">Automation running...</span>
          </div>
          <p className="text-xs text-blue-500 mt-1">
            Logging into People Planner and downloading 3 export files. Please wait.
          </p>
        </div>
      )}

      {/* Downloaded Files & Process Button */}
      {status && status.hasRecentDownloads && (
        <div className="space-y-3 pt-2 border-t">
          <Label className="text-sm font-medium flex items-center gap-2">
            <span className="w-5 h-5 rounded-full bg-green-100 dark:bg-green-900 flex items-center justify-center text-xs font-bold text-green-600">4</span>
            Process & Load Data
          </Label>
          
          <div className="space-y-1 p-3 bg-gray-50 dark:bg-gray-900 rounded-lg">
            {recentFiles.slice(0, 3).map((file, idx) => (
              <div key={idx} className="flex items-center gap-2 text-xs">
                <CheckCircle className="w-3 h-3 text-green-500" />
                <span className="truncate flex-1 font-mono">{file.name}</span>
                <span className="text-muted-foreground">
                  {file.exportType}
                </span>
              </div>
            ))}
          </div>

          {canProcess ? (
            <Button
              onClick={() => processMutation.mutate({
                visitsFileId: visitsFile.id,
                caregiversFileId: caregiversFile.id,
                availabilityFileId: availabilityFile.id,
              })}
              disabled={processMutation.isPending}
              className="w-full"
              variant="default"
            >
              {processMutation.isPending ? (
                <>
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <CheckCircle className="w-4 h-4 mr-2" />
                  Process & Load into Dashboard
                </>
              )}
            </Button>
          ) : (
            <div className="text-xs text-amber-600 dark:text-amber-400 p-2 bg-amber-50 dark:bg-amber-900/20 rounded flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              Missing required exports. Need: Visits, Caregivers, and Availability files.
            </div>
          )}
        </div>
      )}
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
          <h3 className="font-semibold">Sync from People Planner</h3>
          <p className="text-sm text-muted-foreground">Download and process data automatically</p>
        </div>
      </div>
      <PPAutomationContent />
    </div>
  );
}
