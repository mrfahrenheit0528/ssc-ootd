import React, { Children, Fragment, isValidElement, useId } from 'react'
import * as SelectPrimitive from '@radix-ui/react-select'
import { Check, ChevronDown, ChevronUp } from 'lucide-react'

// Retain the dashboard's option/optgroup data and value-change handlers while
// sharing one accessible, portalled menu across pages and modal forms.
export default function Select({ children, value = '', onChange, disabled = false, className = '', id, name, ...triggerProps }) {
  const emptyValue = `ssc-empty-${useId()}`
  const encode = optionValue => String(optionValue) === '' ? emptyValue : String(optionValue)
  const change = next => {
    const target = { value: next === emptyValue ? '' : next, id, name }
    onChange?.({ target, currentTarget: target })
  }
  const renderOptions = (nodes, groupDisabled = false) => Children.toArray(nodes).map(node => {
    if (!isValidElement(node)) return null
    if (node.type === Fragment) return <Fragment key={node.key}>{renderOptions(node.props.children, groupDisabled)}</Fragment>
    if (node.type === 'optgroup') return (
      <SelectPrimitive.Group key={node.key}>
        <SelectPrimitive.Label className="select-group-label">{node.props.label}</SelectPrimitive.Label>
        {renderOptions(node.props.children, groupDisabled || node.props.disabled)}
      </SelectPrimitive.Group>
    )
    if (node.type !== 'option') return null
    return (
      <SelectPrimitive.Item key={node.key} value={encode(node.props.value)}
        disabled={groupDisabled || node.props.disabled} className="select-item">
        <SelectPrimitive.ItemText>{node.props.children}</SelectPrimitive.ItemText>
        <SelectPrimitive.ItemIndicator className="select-check"><Check className="h-4 w-4" aria-hidden="true" /></SelectPrimitive.ItemIndicator>
      </SelectPrimitive.Item>
    )
  })
  return (
    <>
      {name && <input type="hidden" name={name} value={value} disabled={disabled} />}
      <SelectPrimitive.Root value={encode(value)} onValueChange={change} disabled={disabled}>
        <SelectPrimitive.Trigger {...triggerProps} id={id} type="button" className={`input select-trigger ${className}`}>
          <span className="min-w-0 flex-1 truncate text-left"><SelectPrimitive.Value /></span>
          <SelectPrimitive.Icon asChild><ChevronDown className="select-chevron h-4 w-4 shrink-0" aria-hidden="true" /></SelectPrimitive.Icon>
        </SelectPrimitive.Trigger>
        <SelectPrimitive.Portal>
          <SelectPrimitive.Content className="select-content" position="popper" sideOffset={6} collisionPadding={12}>
            <SelectPrimitive.ScrollUpButton className="select-scroll-button"><ChevronUp className="h-4 w-4" aria-hidden="true" /></SelectPrimitive.ScrollUpButton>
            <SelectPrimitive.Viewport className="select-viewport">{renderOptions(children)}</SelectPrimitive.Viewport>
            <SelectPrimitive.ScrollDownButton className="select-scroll-button"><ChevronDown className="h-4 w-4" aria-hidden="true" /></SelectPrimitive.ScrollDownButton>
          </SelectPrimitive.Content>
        </SelectPrimitive.Portal>
      </SelectPrimitive.Root>
    </>
  )
}
