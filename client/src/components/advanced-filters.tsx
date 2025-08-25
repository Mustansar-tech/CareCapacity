import React, { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { CalendarIcon, Filter, X, Search, Save, RotateCcw } from "lucide-react";
import { format } from "date-fns";
import type { ProcessingResult } from "@shared/schema";

interface FilterState {
  searchText: string;
  dateRange: {
    from: Date | undefined;
    to: Date | undefined;
  };
  statuses: string[];
  capacityRange: {
    min: number;
    max: number;
  };
  showShortageOnly: boolean;
  employees: string[];
}

interface SavedFilter {
  id: string;
  name: string;
  filter: FilterState;
  createdAt: Date;
}

interface AdvancedFiltersProps {
  data: ProcessingResult | null;
  onFilterChange: (filteredData: ProcessingResult) => void;
  onResetFilters: () => void;
}

const DEFAULT_FILTER: FilterState = {
  searchText: "",
  dateRange: { from: undefined, to: undefined },
  statuses: [],
  capacityRange: { min: 0, max: 100 },
  showShortageOnly: false,
  employees: []
};

export function AdvancedFilters({ data, onFilterChange, onResetFilters }: AdvancedFiltersProps) {
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTER);
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>([]);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [saveFilterName, setSaveFilterName] = useState("");
  const [isFiltering, setIsFiltering] = useState(false);

  // Get unique values for filter options
  const uniqueStatuses = data ? Array.from(new Set(
    Object.values(data.employeesByDate).flat().map(emp => emp.status)
  )).sort() : [];

  const uniqueEmployees = data ? Array.from(new Set(
    Object.values(data.employeesByDate).flat().map(emp => emp.employeeName)
  )).sort() : [];

  // Load saved filters from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('capacity-dashboard-filters');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setSavedFilters(parsed.map((f: any) => ({
          ...f,
          createdAt: new Date(f.createdAt)
        })));
      } catch (e) {
        console.warn('Failed to load saved filters:', e);
      }
    }
  }, []);

  // Save filters to localStorage
  const saveFiltersToStorage = (filters: SavedFilter[]) => {
    localStorage.setItem('capacity-dashboard-filters', JSON.stringify(filters));
    setSavedFilters(filters);
  };

  // Apply filters to data
  useEffect(() => {
    if (!data) return;

    setIsFiltering(true);
    const timer = setTimeout(() => {
      let filteredData = { ...data };

      // Filter daily summary
      filteredData.dailySummary = data.dailySummary.filter(day => {
        // Date range filter
        if (filters.dateRange.from || filters.dateRange.to) {
          const dayDate = new Date(day.date);
          if (filters.dateRange.from && dayDate < filters.dateRange.from) return false;
          if (filters.dateRange.to && dayDate > filters.dateRange.to) return false;
        }

        // Shortage filter
        if (filters.showShortageOnly && day.status !== 'Shortage') return false;

        // Capacity range filter
        if (day.netCapacity < filters.capacityRange.min || day.netCapacity > filters.capacityRange.max) {
          return false;
        }

        return true;
      });

      // Filter employees by date
      filteredData.employeesByDate = {};
      Object.entries(data.employeesByDate).forEach(([date, employees]) => {
        // Check if this date passes the daily summary filters
        const dayPasses = filteredData.dailySummary.some(day => day.date === date);
        if (!dayPasses) return;

        let filteredEmployees = employees.filter(emp => {
          // Search text filter
          if (filters.searchText) {
            const searchLower = filters.searchText.toLowerCase();
            if (!emp.employeeName.toLowerCase().includes(searchLower) &&
                !emp.status.toLowerCase().includes(searchLower) &&
                !emp.timeWindows.toLowerCase().includes(searchLower)) {
              return false;
            }
          }

          // Status filter
          if (filters.statuses.length > 0 && !filters.statuses.includes(emp.status)) {
            return false;
          }

          // Employee filter
          if (filters.employees.length > 0 && !filters.employees.includes(emp.employeeName)) {
            return false;
          }

          return true;
        });

        if (filteredEmployees.length > 0) {
          filteredData.employeesByDate[date] = filteredEmployees;
        }
      });

      onFilterChange(filteredData);
      setIsFiltering(false);
    }, 300);

    return () => clearTimeout(timer);
  }, [filters, data, onFilterChange]);

  const handleSaveFilter = () => {
    if (!saveFilterName.trim()) return;

    const newFilter: SavedFilter = {
      id: Date.now().toString(),
      name: saveFilterName.trim(),
      filter: { ...filters },
      createdAt: new Date()
    };

    saveFiltersToStorage([...savedFilters, newFilter]);
    setSaveFilterName("");
    setShowSaveDialog(false);
  };

  const loadSavedFilter = (savedFilter: SavedFilter) => {
    setFilters(savedFilter.filter);
  };

  const deleteSavedFilter = (id: string) => {
    saveFiltersToStorage(savedFilters.filter(f => f.id !== id));
  };

  const resetFilters = () => {
    setFilters(DEFAULT_FILTER);
    onResetFilters();
  };

  const activeFilterCount = Object.values(filters).reduce((count, value) => {
    if (Array.isArray(value) && value.length > 0) return count + 1;
    if (typeof value === 'string' && value.length > 0) return count + 1;
    if (typeof value === 'boolean' && value) return count + 1;
    if (typeof value === 'object' && value !== null && 'from' in value) {
      return count + (value.from || value.to ? 1 : 0);
    }
    return count;
  }, 0);

  return (
    <Card className="w-full" data-testid="advanced-filters">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-lg font-semibold flex items-center gap-2">
          <Filter className="h-5 w-5" />
          Advanced Filters
          {activeFilterCount > 0 && (
            <Badge variant="secondary" className="ml-2">
              {activeFilterCount}
            </Badge>
          )}
        </CardTitle>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={resetFilters}
            data-testid="button-reset-filters"
          >
            <RotateCcw className="h-4 w-4 mr-1" />
            Reset
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowSaveDialog(true)}
            data-testid="button-save-filter"
          >
            <Save className="h-4 w-4 mr-1" />
            Save
          </Button>
        </div>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {/* Search */}
        <div className="space-y-2">
          <label className="text-sm font-medium">Search</label>
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search employees, statuses, notes..."
              value={filters.searchText}
              onChange={(e) => setFilters(prev => ({ ...prev, searchText: e.target.value }))}
              className="pl-10"
              data-testid="input-search-filter"
            />
          </div>
        </div>

        {/* Date Range */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">From Date</label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className="w-full justify-start text-left font-normal"
                  data-testid="button-date-from"
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {filters.dateRange.from ? format(filters.dateRange.from, "PPP") : "Pick a date"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={filters.dateRange.from}
                  onSelect={(date) => setFilters(prev => ({ 
                    ...prev, 
                    dateRange: { ...prev.dateRange, from: date }
                  }))}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
          </div>
          
          <div className="space-y-2">
            <label className="text-sm font-medium">To Date</label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className="w-full justify-start text-left font-normal"
                  data-testid="button-date-to"
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {filters.dateRange.to ? format(filters.dateRange.to, "PPP") : "Pick a date"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={filters.dateRange.to}
                  onSelect={(date) => setFilters(prev => ({ 
                    ...prev, 
                    dateRange: { ...prev.dateRange, to: date }
                  }))}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
          </div>
        </div>

        {/* Status Filter */}
        <div className="space-y-2">
          <label className="text-sm font-medium">Status</label>
          <div className="flex flex-wrap gap-2">
            {uniqueStatuses.map(status => (
              <div key={status} className="flex items-center space-x-2">
                <Checkbox
                  id={`status-${status}`}
                  checked={filters.statuses.includes(status)}
                  onCheckedChange={(checked) => {
                    if (checked) {
                      setFilters(prev => ({ 
                        ...prev, 
                        statuses: [...prev.statuses, status]
                      }));
                    } else {
                      setFilters(prev => ({ 
                        ...prev, 
                        statuses: prev.statuses.filter(s => s !== status)
                      }));
                    }
                  }}
                  data-testid={`checkbox-status-${status}`}
                />
                <label
                  htmlFor={`status-${status}`}
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                >
                  {status}
                </label>
              </div>
            ))}
          </div>
        </div>

        {/* Capacity Range */}
        <div className="space-y-2">
          <label className="text-sm font-medium">Net Capacity Range</label>
          <div className="grid grid-cols-2 gap-2">
            <Input
              type="number"
              placeholder="Min"
              value={filters.capacityRange.min}
              onChange={(e) => setFilters(prev => ({ 
                ...prev, 
                capacityRange: { ...prev.capacityRange, min: Number(e.target.value) || 0 }
              }))}
              data-testid="input-capacity-min"
            />
            <Input
              type="number"
              placeholder="Max"
              value={filters.capacityRange.max}
              onChange={(e) => setFilters(prev => ({ 
                ...prev, 
                capacityRange: { ...prev.capacityRange, max: Number(e.target.value) || 100 }
              }))}
              data-testid="input-capacity-max"
            />
          </div>
        </div>

        {/* Shortage Only */}
        <div className="flex items-center space-x-2">
          <Checkbox
            id="shortage-only"
            checked={filters.showShortageOnly}
            onCheckedChange={(checked) => setFilters(prev => ({ 
              ...prev, 
              showShortageOnly: checked as boolean
            }))}
            data-testid="checkbox-shortage-only"
          />
          <label
            htmlFor="shortage-only"
            className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
          >
            Show shortage days only
          </label>
        </div>

        {/* Saved Filters */}
        {savedFilters.length > 0 && (
          <>
            <Separator />
            <div className="space-y-2">
              <label className="text-sm font-medium">Saved Filters</label>
              <div className="flex flex-wrap gap-2">
                {savedFilters.map(savedFilter => (
                  <Badge 
                    key={savedFilter.id} 
                    variant="outline" 
                    className="cursor-pointer hover:bg-accent flex items-center gap-1"
                    onClick={() => loadSavedFilter(savedFilter)}
                    data-testid={`badge-saved-filter-${savedFilter.id}`}
                  >
                    {savedFilter.name}
                    <X 
                      className="h-3 w-3 hover:bg-destructive hover:text-destructive-foreground rounded-full"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteSavedFilter(savedFilter.id);
                      }}
                    />
                  </Badge>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Save Filter Dialog */}
        {showSaveDialog && (
          <div className="space-y-2 p-4 border rounded-lg bg-muted/50">
            <label className="text-sm font-medium">Save Current Filter</label>
            <div className="flex gap-2">
              <Input
                placeholder="Filter name..."
                value={saveFilterName}
                onChange={(e) => setSaveFilterName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSaveFilter()}
                data-testid="input-save-filter-name"
              />
              <Button 
                onClick={handleSaveFilter} 
                disabled={!saveFilterName.trim()}
                data-testid="button-confirm-save-filter"
              >
                Save
              </Button>
              <Button 
                variant="outline" 
                onClick={() => setShowSaveDialog(false)}
                data-testid="button-cancel-save-filter"
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {isFiltering && (
          <div className="text-sm text-muted-foreground">
            Applying filters...
          </div>
        )}
      </CardContent>
    </Card>
  );
}