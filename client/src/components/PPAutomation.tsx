import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Calendar, Download, RefreshCw, Bot, CheckCircle, XCircle, Clock, AlertTriangle } from 'lucide-react';
import { apiRequest } from '@/lib/queryClient';

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

export function PPAutomation() {
  const [selectedBranch, setSelectedBranch] = useState<string>('');
  const [selectedWeek, setSelectedWeek] = useState<string>('0');
  const { toast } = useToast();

  const { data: branches, isLoading: loadingBranches } = useQuery<PPBranch[]>({
    queryKey: ['/api/pp-automation/branches'],
  });

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
          title: 'Export Complete',
          description: 'All files downloaded successfully from People Planner.',
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
        title: 'Export Failed',
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
        title: 'Processing Complete',
        description: 'Files have been processed and data is now available in the dashboard.',
      });
      refetchStatus();
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
        description: 'Please select a branch to export data for.',
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

  return (
    <Card className="glass-card hover-lift animate-slide-up">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-purple-100 dark:bg-purple-900 flex items-center justify-center">
            <Bot className="w-4 h-4 text-purple-600 dark:text-purple-400" />
          </div>
          <span className="bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent">
            People Planner Automation
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="pp-branch" className="text-sm font-medium">Branch</Label>
            <Select value={selectedBranch} onValueChange={setSelectedBranch}>
              <SelectTrigger id="pp-branch" className="w-full">
                <SelectValue placeholder={loadingBranches ? "Loading branches..." : "Select branch"} />
              </SelectTrigger>
              <SelectContent>
                {branches?.map((branch) => (
                  <SelectItem key={branch.name} value={branch.name}>
                    {branch.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedBranch && branches && (
              <p className="text-xs text-gray-500">
                PP Franchise: {branches.find(b => b.name === selectedBranch)?.franchiseName}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="pp-week" className="text-sm font-medium">Week</Label>
            <Select value={selectedWeek} onValueChange={setSelectedWeek}>
              <SelectTrigger id="pp-week" className="w-full">
                <SelectValue placeholder="Select week" />
              </SelectTrigger>
              <SelectContent>
                {weekOptions.map((week) => (
                  <SelectItem key={week.id} value={week.id}>
                    <div className="flex items-center gap-2">
                      <Calendar className="w-3 h-3" />
                      <span>{week.name}</span>
                      <span className="text-xs text-gray-500">({week.label})</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedWeekData && (
              <p className="text-xs text-gray-500">
                {selectedWeekData.start} to {selectedWeekData.end}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 pt-2">
          <Button
            onClick={handleExport}
            disabled={!selectedBranch || exportMutation.isPending}
            className="flex-1 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white"
          >
            {exportMutation.isPending ? (
              <>
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                Downloading from PP...
              </>
            ) : (
              <>
                <Download className="w-4 h-4 mr-2" />
                Download Exports
              </>
            )}
          </Button>
        </div>

        {exportMutation.isPending && (
          <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg animate-pulse">
            <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400">
              <RefreshCw className="w-4 h-4 animate-spin" />
              <span className="text-sm font-medium">Automation running...</span>
            </div>
            <p className="text-xs text-blue-500 mt-1">
              Logging into People Planner and downloading exports. This may take 1-2 minutes.
            </p>
          </div>
        )}

        {status && status.hasRecentDownloads && (
          <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
            <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
              <Clock className="w-4 h-4" />
              Recent Downloads
            </h4>
            <div className="space-y-1">
              {status.files.slice(0, 6).map((file, idx) => (
                <div key={idx} className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
                  <CheckCircle className="w-3 h-3 text-green-500" />
                  <span className="truncate flex-1">{file.name}</span>
                  <span className="text-gray-400">
                    {new Date(file.downloadedAt).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
            
            {(() => {
              const recentFiles = status.files.slice(0, 6);
              const visitsFile = recentFiles.find(f => f.exportType === 'visits');
              const caregiversFile = recentFiles.find(f => f.exportType === 'caregivers');
              const availabilityFile = recentFiles.find(f => f.exportType === 'availability');
              const canProcess = visitsFile && caregiversFile && availabilityFile;
              
              return (
                <div className="mt-3">
                  {canProcess ? (
                    <Button
                      onClick={() => processMutation.mutate({
                        visitsFileId: visitsFile.id,
                        caregiversFileId: caregiversFile.id,
                        availabilityFileId: availabilityFile.id,
                      })}
                      disabled={processMutation.isPending}
                      className="w-full"
                      variant="secondary"
                    >
                      {processMutation.isPending ? (
                        <>
                          <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                          Processing...
                        </>
                      ) : (
                        <>
                          <CheckCircle className="w-4 h-4 mr-2" />
                          Process Downloads
                        </>
                      )}
                    </Button>
                  ) : (
                    <div className="text-xs text-amber-600 dark:text-amber-400 p-2 bg-amber-50 dark:bg-amber-900/20 rounded">
                      Missing required exports. Need: Visits, Caregivers, and Availability files.
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        )}

        <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
          <div className="flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg">
            <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
            <div className="text-xs text-amber-700 dark:text-amber-400">
              <p className="font-medium">Credentials Required</p>
              <p className="mt-1">
                Set PP_CLIENT_ID, PP_USERNAME, and PP_PASSWORD in your environment secrets to enable automation.
              </p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
