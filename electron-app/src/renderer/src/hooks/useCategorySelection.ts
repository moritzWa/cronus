import { useEffect, useState } from 'react'
import { type Category } from 'shared/dist/types'
import { templateCategories } from '../components/Settings/CategoryTemplateList'

type HistoryData =
  | {
      title: string | null
      categoryId: string | null
      categoryName: string | null
      categoryColor: string | null
    }[]
  | undefined

interface UseCategorySelectionProps {
  categories: Category[]
  historyData: HistoryData
  inputValue: string
  selectedCategory: Category | null
}

export const useCategorySelection = ({
  categories,
  historyData,
  inputValue,
  selectedCategory
}: UseCategorySelectionProps) => {
  const [searchResults, setSearchResults] = useState<Category[]>([])
  const [templateResults, setTemplateResults] = useState<typeof templateCategories>([])
  const [historyResults, setHistoryResults] = useState<HistoryData>([])
  const [isPopoverOpen, setIsPopoverOpen] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(-1)

  useEffect(() => {
    if (!inputValue.trim() || !categories || selectedCategory) {
      setSearchResults([])
      setTemplateResults([])
      setHistoryResults([])
      setIsPopoverOpen(false)
      return
    }

    const lowerCaseQuery = inputValue.toLowerCase()

    // Filter history
    if (historyData) {
      const filteredHistory = historyData.filter(
        (item) =>
          item.title?.toLowerCase().includes(lowerCaseQuery) ||
          item.categoryName?.toLowerCase().includes(lowerCaseQuery)
      )
      setHistoryResults(filteredHistory)
    }

    // Filter categories
    const filteredCategories = categories.filter((cat) =>
      cat.name.toLowerCase().includes(lowerCaseQuery)
    )
    setSearchResults(filteredCategories)

    const existingCategoryNames = new Set(categories.map((c) => c.name.toLowerCase()))
    const filteredTemplates = templateCategories.filter((template) => {
      const templateNameLower = template.name.toLowerCase()
      if (existingCategoryNames.has(templateNameLower)) return false
      return (
        templateNameLower.includes(lowerCaseQuery) ||
        template.description?.toLowerCase().includes(lowerCaseQuery)
      )
    })
    setTemplateResults(filteredTemplates)

    setIsPopoverOpen(
      (historyResults && historyResults.length > 0) ||
        filteredCategories.length > 0 ||
        filteredTemplates.length > 0 ||
        (inputValue.trim() !== '' && !selectedCategory)
    )
    setHighlightedIndex(-1)
  }, [inputValue, categories, selectedCategory, historyData])

  const showCreateOption =
    inputValue.trim() !== '' &&
    !searchResults.some((cat) => cat.name.toLowerCase() === inputValue.toLowerCase()) &&
    !templateResults.some((template) => template.name.toLowerCase() === inputValue.toLowerCase()) &&
    !historyResults?.some((hist) => hist.title?.toLowerCase() === inputValue.toLowerCase())

  const handleKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
    onSelectHistory: (item: NonNullable<typeof historyResults>[0]) => void,
    onSelectCategory: (category: Category) => void,
    onSelectTemplate: (template: (typeof templateCategories)[0]) => void,
    onShowCategoryForm: () => void,
    onSubmit: () => void
  ) => {
    if (isPopoverOpen) {
      const itemsCount =
        (historyResults?.length || 0) +
        searchResults.length +
        templateResults.length +
        (showCreateOption ? 1 : 0)
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setHighlightedIndex((prev) => (prev + 1) % itemsCount)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setHighlightedIndex((prev) => (prev - 1 + itemsCount) % itemsCount)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        if (highlightedIndex >= 0) {
          const historyCount = historyResults?.length || 0
          const userCategoriesCount = searchResults.length

          if (highlightedIndex < historyCount) {
            onSelectHistory(historyResults![highlightedIndex])
          } else if (highlightedIndex < historyCount + userCategoriesCount) {
            onSelectCategory(searchResults[highlightedIndex - historyCount])
          } else if (
            highlightedIndex <
            historyCount + userCategoriesCount + templateResults.length
          ) {
            onSelectTemplate(templateResults[highlightedIndex - historyCount - userCategoriesCount])
          } else {
            onShowCategoryForm()
          }
        } else {
          onSubmit()
        }
      } else if (e.key === 'Escape') {
        setIsPopoverOpen(false)
      }
    } else {
      if (e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        onSubmit()
      }
    }
  }

  return {
    searchResults,
    templateResults,
    historyResults,
    isPopoverOpen,
    setIsPopoverOpen,
    highlightedIndex,
    setHighlightedIndex,
    showCreateOption,
    handleKeyDown
  }
}
