import { Check, Loader2 } from 'lucide-react'
import { JSX, useState } from 'react'
import { Category } from 'shared/dist/types.js'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover'
import { Switch } from '../ui/switch'
import { Textarea } from '../ui/textarea'
import { IsProductiveTooltip } from './IsProductiveTooltip'

export const notionStyleCategoryColors = [
  '#3B82F6', // Blue - defualt productive
  '#EC4899', // Pink - default unproductive
  '#A855F7', // Purple
  '#F97316', // Orange
  '#CA8A04', // Gold
  '#10B981', // Green
  '#06B6D4', // Cyan
  '#6B7280', // Gray
  '#8B5CF6', // Violet
  '#D946EF', // Fuchsia
  '#F59E0B', // Amber
  '#22C55E' // Lime
]

interface CategoryColorPickerProps {
  selectedColor: string
  onColorChange: (color: string) => void
}

function CategoryColorPicker({
  selectedColor,
  onColorChange
}: CategoryColorPickerProps): JSX.Element {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className="w-10 h-10 p-0 border-border hover:border-ring flex-shrink-0"
          style={{ backgroundColor: selectedColor, transition: 'background-color 0.2s' }}
          aria-label="Pick a color"
          title={selectedColor}
        ></Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0 bg-popover border-border">
        <div className="grid grid-cols-6 gap-2 p-3 rounded-md">
          {notionStyleCategoryColors.map((bgColor) => (
            <button
              type="button"
              key={bgColor}
              className={`w-8 h-8 rounded-full flex items-center justify-center focus:outline-none ring-1 ring-border hover:ring-2 hover:ring-ring transition-all`}
              style={{ backgroundColor: bgColor }}
              onClick={() => {
                onColorChange(bgColor)
              }}
              title={bgColor}
            >
              {selectedColor === bgColor && <Check size={18} className="text-white" />}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

// Basic Form for Create/Edit
interface CategoryFormProps {
  initialData?: Category
  onSave: (data: Omit<Category, '_id' | 'userId' | 'createdAt' | 'updatedAt'>) => void
  onCancel: () => void
  isSaving: boolean
}

export function CategoryForm({
  initialData,
  onSave,
  onCancel,
  isSaving
}: CategoryFormProps): JSX.Element {
  const [name, setName] = useState(initialData?.name || '')
  const [description, setDescription] = useState(initialData?.description || '')
  const [color, setColor] = useState(
    initialData?.color ||
      notionStyleCategoryColors[Math.floor(Math.random() * notionStyleCategoryColors.length)]
  )
  const [isProductive, setIsProductive] = useState(
    initialData?.isProductive === undefined ? true : initialData.isProductive
  )
  const [error, setError] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      setError('Name is required.')
      return
    }
    setError('')
    onSave({ name, description, color, isProductive, isDefault: initialData?.isDefault ?? false })
  }

  return (
    <form onSubmit={handleSubmit} className="p-6 bg-card rounded-lg shadow-md space-y-6">
      <div>
        <Label htmlFor="categoryName" className="block text-sm font-medium text-foreground mb-1">
          Name <span className="text-red-500">*</span>
        </Label>
        <Input
          placeholder="Enter category name"
          id="categoryName"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full px-3 py-2 bg-input border border-border rounded-md text-foreground focus:ring-primary focus:border-primary"
          required
        />
      </div>
      <div>
        <Label
          htmlFor="categoryDescription"
          className="block text-sm font-medium text-foreground mb-1"
        >
          Description
        </Label>
        <Textarea
          rows={2}
          placeholder="Enter category description"
          id="categoryDescription"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="w-full px-3 py-2 bg-input border border-border rounded-md text-foreground focus:ring-primary focus:border-primary resize-none"
        />
      </div>

      {/* Container for Type and Color, arranged side-by-side on medium screens and up */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <IsProductiveTooltip>
          <div className="flex items-center space-x-2 mt-1 cursor-help">
            <Switch id="isProductive" checked={isProductive} onCheckedChange={setIsProductive} />
            <Label htmlFor="isProductive" className="text-foreground text-sm font-medium">
              {isProductive ? 'Productive' : 'Unproductive'}
            </Label>
          </div>
        </IsProductiveTooltip>

        <div>
          <div className="flex items-start space-x-2 mt-1">
            <CategoryColorPicker selectedColor={color} onColorChange={setColor} />
            <span className="text-red-500">*</span>
          </div>
        </div>

        {error && <p className="text-sm text-destructive-foreground">{error}</p>}
        <Button type="button" variant="secondary" onClick={onCancel} disabled={isSaving}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSaving} className="flex items-center">
          {isSaving ? (
            <>
              <Loader2 className="animate-spin -ml-1 mr-3 h-5 w-5 text-primary-foreground" />
              Saving...
            </>
          ) : (
            'Save Category'
          )}
        </Button>
      </div>
    </form>
  )
}
