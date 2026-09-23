import { EmptyState } from './ui'

export function Forbidden({ message }: { message: string }) {
  return <EmptyState body={message} />
}
