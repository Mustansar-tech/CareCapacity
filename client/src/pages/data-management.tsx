import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { Trash2, Shield, Clock, Database, AlertTriangle, CheckCircle, Eye } from 'lucide-react';
import { apiRequest } from '@/lib/queryClient';

interface CleanupPreview {
  cutoffDate: string;
  monthsOld: number;
  totalAnalyses: number;
  analysesToDelete: number;
  analysesToKeep: number;
  oldestAnalysis: string | null;
  newestAnalysis: string | null;
}

export default function DataManagement() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedMonths, setSelectedMonths] = useState(6);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  // Get cleanup preview
  const { data: cleanupPreview, refetch: refetchPreview } = useQuery<CleanupPreview>({
    queryKey: ['/api/cleanup/preview', selectedMonths],
  });

  // Get all historical data for overview
  const { data: allData } = useQuery<any[]>({
    queryKey: ['/api/history'],
  });

  // Cleanup mutation
  const cleanupMutation = useMutation({
    mutationFn: () => apiRequest('POST', '/api/cleanup', { months: selectedMonths }),
    onSuccess: (data: any) => {
      toast({
        title: "Data Cleanup Successful",
        description: `Deleted ${data.deletedAnalyses} old analyses (older than ${data.cutoffMonths} months)`
      });
      queryClient.invalidateQueries({ queryKey: ['/api/history'] });
      queryClient.invalidateQueries({ queryKey: ['/api/cleanup/preview'] });
      setShowDeleteDialog(false);
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Cleanup Failed",
        description: error.message || "Failed to cleanup old data"
      });
    }
  });

  const handleCleanup = () => {
    cleanupMutation.mutate();
  };

  // Calculate data age statistics
  const dataStats = React.useMemo(() => {
    if (!allData || allData.length === 0) return null;
    
    const now = new Date();
    const ages = allData.map(analysis => {
      const uploadDate = new Date(analysis.uploadedAt);
      return Math.floor((now.getTime() - uploadDate.getTime()) / (1000 * 60 * 60 * 24));
    });
    
    return {
      oldest: Math.max(...ages),
      newest: Math.min(...ages),
      average: Math.floor(ages.reduce((sum, age) => sum + age, 0) / ages.length)
    };
  }, [allData]);

  return (
    <div className="p-6 max-w-7xl mx-auto" data-testid="data-management-container">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2" data-testid="page-title">
          Data Management & Privacy
        </h1>
        <p className="text-gray-600 dark:text-gray-300" data-testid="page-description">
          Manage your stored data, privacy settings, and automatic cleanup policies
        </p>
      </div>

      {/* Data Security Overview */}
      <Card className="mb-6" data-testid="security-overview">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-green-600" />
            Data Security & Storage
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="flex items-center gap-3 p-3 bg-green-50 dark:bg-green-900/20 rounded-lg">
              <Database className="w-8 h-8 text-green-600" />
              <div>
                <div className="font-medium">Secure Storage</div>
                <div className="text-sm text-gray-600 dark:text-gray-400">PostgreSQL Database</div>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
              <CheckCircle className="w-8 h-8 text-blue-600" />
              <div>
                <div className="font-medium">Encrypted Transit</div>
                <div className="text-sm text-gray-600 dark:text-gray-400">HTTPS Protected</div>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 bg-purple-50 dark:bg-purple-900/20 rounded-lg">
              <Clock className="w-8 h-8 text-purple-600" />
              <div>
                <div className="font-medium">Auto-Cleanup</div>
                <div className="text-sm text-gray-600 dark:text-gray-400">6-Month Policy</div>
              </div>
            </div>
          </div>
          
          <Alert>
            <Shield className="h-4 w-4" />
            <AlertDescription>
              Your data is stored securely in an encrypted PostgreSQL database. All data transmission is protected with HTTPS encryption. 
              For development environments, consider regular backups of important analyses.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>

      {/* Data Overview */}
      <Card className="mb-6" data-testid="data-overview">
        <CardHeader>
          <CardTitle>Current Data Storage</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-600">{allData?.length || 0}</div>
              <div className="text-sm text-gray-600 dark:text-gray-400">Total Analyses</div>
            </div>
            {dataStats && (
              <>
                <div className="text-center">
                  <div className="text-2xl font-bold text-green-600">{dataStats.newest}</div>
                  <div className="text-sm text-gray-600 dark:text-gray-400">Days Since Latest</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-orange-600">{dataStats.oldest}</div>
                  <div className="text-sm text-gray-600 dark:text-gray-400">Days Since Oldest</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-purple-600">{dataStats.average}</div>
                  <div className="text-sm text-gray-600 dark:text-gray-400">Average Age (Days)</div>
                </div>
              </>
            )}
          </div>
          
          {cleanupPreview && (
            <Alert>
              <Eye className="h-4 w-4" />
              <AlertDescription>
                With a 6-month cleanup policy, {cleanupPreview.analysesToDelete} analyses would be automatically deleted, 
                keeping {cleanupPreview.analysesToKeep} recent analyses.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Automatic Cleanup Settings */}
      <Card className="mb-6" data-testid="cleanup-settings">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trash2 className="w-5 h-5" />
            Automatic Data Cleanup
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4 mb-4">
            <label className="text-sm font-medium">Cleanup Period:</label>
            <div className="flex gap-2">
              {[3, 6, 12, 24].map(months => (
                <Button
                  key={months}
                  variant={selectedMonths === months ? "default" : "outline"}
                  size="sm"
                  onClick={() => {
                    setSelectedMonths(months);
                    setTimeout(() => refetchPreview(), 100);
                  }}
                  data-testid={`button-months-${months}`}
                >
                  {months} months
                </Button>
              ))}
            </div>
          </div>

          {cleanupPreview && (
            <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg">
              <h4 className="font-medium mb-2">Cleanup Preview ({selectedMonths} months)</h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <span className="text-gray-600 dark:text-gray-400">Total Analyses:</span>
                  <div className="font-medium">{cleanupPreview.totalAnalyses}</div>
                </div>
                <div>
                  <span className="text-red-600">To Delete:</span>
                  <div className="font-medium text-red-600">{cleanupPreview.analysesToDelete}</div>
                </div>
                <div>
                  <span className="text-green-600">To Keep:</span>
                  <div className="font-medium text-green-600">{cleanupPreview.analysesToKeep}</div>
                </div>
                <div>
                  <span className="text-gray-600 dark:text-gray-400">Cutoff Date:</span>
                  <div className="font-medium">{new Date(cleanupPreview.cutoffDate).toLocaleDateString()}</div>
                </div>
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
              <DialogTrigger asChild>
                <Button 
                  variant="destructive" 
                  className="flex items-center gap-2"
                  disabled={!cleanupPreview || cleanupPreview.analysesToDelete === 0}
                  data-testid="button-cleanup-now"
                >
                  <Trash2 className="w-4 h-4" />
                  Clean Up Now ({cleanupPreview?.analysesToDelete || 0} analyses)
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <AlertTriangle className="w-5 h-5 text-red-600" />
                    Confirm Data Deletion
                  </DialogTitle>
                  <DialogDescription>
                    This action will permanently delete {cleanupPreview?.analysesToDelete} capacity analyses 
                    older than {selectedMonths} months (before {cleanupPreview?.cutoffDate && new Date(cleanupPreview.cutoffDate).toLocaleDateString()}).
                    <br /><br />
                    <strong>This cannot be undone.</strong> Are you sure you want to proceed?
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setShowDeleteDialog(false)} data-testid="button-cancel-cleanup">
                    Cancel
                  </Button>
                  <Button 
                    variant="destructive" 
                    onClick={handleCleanup}
                    disabled={cleanupMutation.isPending}
                    data-testid="button-confirm-cleanup"
                  >
                    {cleanupMutation.isPending ? 'Deleting...' : 'Yes, Delete Data'}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Button 
              variant="outline"
              onClick={() => refetchPreview()}
              data-testid="button-refresh-preview"
            >
              Refresh Preview
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Privacy Policy Information */}
      <Card data-testid="privacy-info">
        <CardHeader>
          <CardTitle>Data Privacy & Retention</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="prose dark:prose-invert max-w-none">
            <h4>What data we store:</h4>
            <ul className="text-sm space-y-1">
              <li>• Processed capacity analysis results from your Excel uploads</li>
              <li>• Daily summary data and employee capacity calculations</li>
              <li>• Upload timestamps and data processing metadata</li>
            </ul>
            
            <h4>What we don't store:</h4>
            <ul className="text-sm space-y-1">
              <li>• Original Excel files (deleted after processing)</li>
              <li>• Personal identification information beyond employee names</li>
              <li>• Any data outside of capacity analysis workflow</li>
            </ul>
            
            <h4>Automatic retention policy:</h4>
            <p className="text-sm">
              Data older than 6 months is automatically flagged for cleanup to maintain system performance 
              and ensure data freshness. You can manually trigger cleanup or adjust the retention period as needed.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}