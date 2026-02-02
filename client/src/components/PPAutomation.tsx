import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Calendar, Download, RefreshCw, Bot, CheckCircle, Clock, AlertTriangle, Monitor, ExternalLink } from 'lucide-react';
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
    cgDataExport?: string;
    careProGuaranteedHours?: string;
    availabilityExport?: string;
  };
  errors?: string[];
  requiresManualLogin?: boolean;
  invalidSession?: boolean;
}

interface PPFile {
  id: string;
  name: string;
  size: number;
  downloadedAt: string;
  exportType: 'cgDataExport' | 'careProGuaranteedHours' | 'availabilityExport' | 'unknown';
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
  const [loginRequired, setLoginRequired] = useState(false);
  const [invalidSession, setInvalidSession] = useState(false);
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
      const data = await response.json() as PPExportResult;
      
      if (data.requiresManualLogin) {
        setLoginRequired(true);
        throw new Error('Manual login required');
      }
      
      if (data.invalidSession) {
        setInvalidSession(true);
        throw new Error('Invalid session or blocked environment');
      }
      
      return data;
    },
    onSuccess: (data) => {
      setLoginRequired(false);
      setInvalidSession(false);
      
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
      if (!loginRequired && !invalidSession) {
        toast({
          title: 'Download Failed',
          description: error.message || 'Failed to download files from People Planner',
          variant: 'destructive',
        });
      }
    },
  });

  const processMutation = useMutation({
    mutationFn: async ({ cgDataFileId, hoursFileId, availabilityFileId }: { cgDataFileId: string; hoursFileId: string; availabilityFileId: string }) => {
      const response = await apiRequest('POST', '/api/pp-automation/process', { 
        visitsFileId: hoursFileId, 
        caregiversFileId: cgDataFileId, 
        availabilityFileId 
      });
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
    setLoginRequired(false);
    setInvalidSession(false);
    
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
  const cgDataFile = recentFiles.find(f => f.exportType === 'cgDataExport');
  const hoursFile = recentFiles.find(f => f.exportType === 'careProGuaranteedHours');
  const availabilityFile = recentFiles.find(f => f.exportType === 'availabilityExport');
  const canProcess = cgDataFile && hoursFile && availabilityFile;

  return (
    <div className="space-y-4">
      {/* Windows Edge Requirement Notice */}
      <div className="p-4 rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-900/20">
        <div className="flex items-start gap-3">
          <Monitor className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
          <div className="space-y-2 flex-1">
            <p className="font-medium text-blue-800 dark:text-blue-200">Windows Edge Required</p>
            <p className="text-sm text-blue-700 dark:text-blue-300">
              This feature uses your existing Edge browser session. Before syncing:
            </p>
            <ul className="text-sm text-blue-700 dark:text-blue-300 list-disc ml-4 space-y-1">
              <li>Open Microsoft Edge on Windows</li>
              <li>Log into People Planner manually</li>
              <li>Close all Edge windows before running automation</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Login Required Warning */}
      {loginRequired && (
        <div className="p-4 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
            <div className="space-y-2 flex-1">
              <p className="font-medium text-amber-800 dark:text-amber-200">Manual Login Required</p>
              <p className="text-sm text-amber-700 dark:text-amber-300">
                Your People Planner session has expired. Please:
              </p>
              <ol className="text-sm text-amber-700 dark:text-amber-300 list-decimal ml-4 space-y-1">
                <li>Open Microsoft Edge</li>
                <li>Go to peopleplanner.biz and log in</li>
                <li>Close Edge completely</li>
                <li>Try syncing again</li>
              </ol>
            </div>
          </div>
        </div>
      )}

      {/* Invalid Session / Environment Warning */}
      {invalidSession && (
        <div className="p-4 rounded-lg border border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/20">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
            <div className="space-y-2 flex-1">
              <p className="font-medium text-red-800 dark:text-red-200">Environment Not Supported</p>
              <p className="text-sm text-red-700 dark:text-red-300">
                This automation requires Windows with Microsoft Edge installed. Linux environments and headless browsers are blocked by People Planner.
              </p>
            </div>
          </div>
        </div>
      )}

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
            Will sync from: <strong>{matchedBranch.franchiseName}</strong> in People Planner
          </p>
        )}
      </div>

      {/* Step 2: Select Week */}
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

      {/* Step 3: Download Button */}
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
            Opening Edge browser and downloading 3 export files. Please wait.
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
                  {file.exportType === 'cgDataExport' ? 'CG Data' : 
                   file.exportType === 'careProGuaranteedHours' ? 'Guaranteed Hours' : 
                   file.exportType === 'availabilityExport' ? 'Availability' : 'Unknown'}
                </span>
              </div>
            ))}
          </div>

          {canProcess ? (
            <Button
              onClick={() => processMutation.mutate({
                cgDataFileId: cgDataFile.id,
                hoursFileId: hoursFile.id,
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
              Missing required exports. Need: CG Data Export, Care Pro Guaranteed Hours, and Availability Export.
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
