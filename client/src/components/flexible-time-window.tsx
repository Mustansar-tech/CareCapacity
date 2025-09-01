import React, { useState, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Clock, Edit2, Plus, X, Check } from "lucide-react";

interface TimeWindow {
  start: string;
  end: string;
  id?: string;
}

interface FlexibleTimeWindowProps {
  timeWindows: string | TimeWindow[];
  editable?: boolean;
  onUpdate?: (newWindows: TimeWindow[]) => void;
  compact?: boolean;
  className?: string;
}

export function FlexibleTimeWindow({ 
  timeWindows, 
  editable = false, 
  onUpdate, 
  compact = false,
  className = ""
}: FlexibleTimeWindowProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editingWindows, setEditingWindows] = useState<TimeWindow[]>([]);

  // Parse time windows from string or array
  const parseTimeWindows = useCallback((windows: string | TimeWindow[]): TimeWindow[] => {
    if (Array.isArray(windows)) {
      return windows;
    }
    
    if (!windows || windows === '-' || windows === '') {
      return [];
    }
    
    // Handle multiple time windows separated by commas or semicolons
    const windowStrings = windows.split(/[,;]/).map(w => w.trim()).filter(w => w);
    
    return windowStrings.map((windowStr, index) => {
      const parts = windowStr.split('-');
      if (parts.length === 2) {
        return {
          id: `window-${index}`,
          start: parts[0].trim(),
          end: parts[1].trim()
        };
      }
      return {
        id: `window-${index}`,
        start: windowStr,
        end: ''
      };
    });
  }, []);

  const parsedWindows = parseTimeWindows(timeWindows);

  const startEditing = useCallback(() => {
    setEditingWindows([...parsedWindows]);
    setIsEditing(true);
  }, [parsedWindows]);

  const cancelEditing = useCallback(() => {
    setIsEditing(false);
    setEditingWindows([]);
  }, []);

  const saveEditing = useCallback(() => {
    if (onUpdate) {
      onUpdate(editingWindows);
    }
    setIsEditing(false);
    setEditingWindows([]);
  }, [editingWindows, onUpdate]);

  const addTimeWindow = useCallback(() => {
    setEditingWindows(prev => [...prev, {
      id: `new-${Date.now()}`,
      start: '',
      end: ''
    }]);
  }, []);

  const removeTimeWindow = useCallback((index: number) => {
    setEditingWindows(prev => prev.filter((_, i) => i !== index));
  }, []);

  const updateTimeWindow = useCallback((index: number, field: 'start' | 'end', value: string) => {
    setEditingWindows(prev => prev.map((window, i) => 
      i === index ? { ...window, [field]: value } : window
    ));
  }, []);

  const formatDuration = useCallback((start: string, end: string): string => {
    if (!start || !end) return '';
    
    try {
      const startTime = new Date(`2000-01-01 ${start}`);
      const endTime = new Date(`2000-01-01 ${end}`);
      let diff = (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60);
      
      if (diff < 0) diff += 24; // Handle overnight shifts
      
      return `(${diff.toFixed(1)}h)`;
    } catch {
      return '';
    }
  }, []);

  if (isEditing) {
    return (
      <div className={`space-y-2 ${className}`} data-testid="time-window-editor">
        {editingWindows.map((window, index) => (
          <div key={window.id || index} className="flex items-center gap-2 p-2 border rounded">
            <Clock className="w-4 h-4 text-gray-500" />
            <Input
              placeholder="HH:MM"
              value={window.start}
              onChange={(e) => updateTimeWindow(index, 'start', e.target.value)}
              className="w-20 text-sm"
              data-testid={`time-window-start-${index}`}
            />
            <span className="text-gray-500">-</span>
            <Input
              placeholder="HH:MM"
              value={window.end}
              onChange={(e) => updateTimeWindow(index, 'end', e.target.value)}
              className="w-20 text-sm"
              data-testid={`time-window-end-${index}`}
            />
            <span className="text-xs text-gray-500 min-w-[40px]">
              {formatDuration(window.start, window.end)}
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => removeTimeWindow(index)}
              className="p-1 h-6 w-6"
              data-testid={`remove-time-window-${index}`}
            >
              <X className="w-3 h-3" />
            </Button>
          </div>
        ))}
        
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={addTimeWindow}
            className="text-xs"
            data-testid="add-time-window"
          >
            <Plus className="w-3 h-3 mr-1" />
            Add Window
          </Button>
          <Button
            size="sm"
            variant="default"
            onClick={saveEditing}
            className="text-xs"
            data-testid="save-time-windows"
          >
            <Check className="w-3 h-3 mr-1" />
            Save
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={cancelEditing}
            className="text-xs"
            data-testid="cancel-time-windows"
          >
            <X className="w-3 h-3 mr-1" />
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  if (parsedWindows.length === 0) {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <span className="text-gray-400" data-testid="no-time-windows">-</span>
        {editable && (
          <Button
            size="sm"
            variant="ghost"
            onClick={startEditing}
            className="p-1 h-6 w-6"
            data-testid="edit-time-windows"
          >
            <Edit2 className="w-3 h-3" />
          </Button>
        )}
      </div>
    );
  }

  if (compact && parsedWindows.length > 2) {
    return (
      <div className={`flex items-center gap-1 ${className}`}>
        <Badge variant="outline" className="text-xs px-2 py-0.5" data-testid="time-window-compact-0">
          {parsedWindows[0].start}-{parsedWindows[0].end}
        </Badge>
        <Popover>
          <PopoverTrigger asChild>
            <Badge variant="secondary" className="text-xs px-2 py-0.5 cursor-pointer" data-testid="time-window-more">
              +{parsedWindows.length - 1} more
            </Badge>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-2" data-testid="time-window-popover">
            <div className="space-y-1">
              {parsedWindows.slice(1).map((window, index) => (
                <Badge key={window.id || `more-${index}`} variant="outline" className="text-xs block" data-testid={`time-window-more-${index + 1}`}>
                  {window.start}-{window.end} {formatDuration(window.start, window.end)}
                </Badge>
              ))}
            </div>
          </PopoverContent>
        </Popover>
        {editable && (
          <Button
            size="sm"
            variant="ghost"
            onClick={startEditing}
            className="p-1 h-6 w-6 ml-1"
            data-testid="edit-time-windows"
          >
            <Edit2 className="w-3 h-3" />
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-1 flex-wrap ${className}`} data-testid="time-window-display">
      {parsedWindows.map((window, index) => (
        <Badge 
          key={window.id || index} 
          variant="outline" 
          className="text-xs px-2 py-0.5 whitespace-nowrap"
          data-testid={`time-window-${index}`}
        >
          <Clock className="w-3 h-3 mr-1" />
          {window.start}-{window.end}
          <span className="ml-1 text-gray-500">
            {formatDuration(window.start, window.end)}
          </span>
        </Badge>
      ))}
      {editable && (
        <Button
          size="sm"
          variant="ghost"
          onClick={startEditing}
          className="p-1 h-6 w-6 ml-1"
          data-testid="edit-time-windows"
        >
          <Edit2 className="w-3 h-3" />
        </Button>
      )}
    </div>
  );
}