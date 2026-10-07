// IPC handlers for tasks, projects and tags: thin wrappers over TaskService
// that tell the renderer to refresh after every change.

import type { TaskService } from '../src/core/tasks/service'
import type { PushEvents } from '../src/shared/ipc'
import type { Handlers } from './ipc'

type TaskChannels = Extract<keyof Handlers, `tasks:${string}` | `projects:${string}` | `tags:${string}`>

export function makeTaskHandlers(
  service: TaskService,
  notify: (event: PushEvents['data:changed']) => void,
): Pick<Handlers, TaskChannels> {
  const changed = <T>(scope: PushEvents['data:changed']['scope'], value: T): T => {
    notify({ scope })
    return value
  }
  return {
    'tasks:list': (query) => service.listTasks(query ?? {}),
    'tasks:get': (id) => service.getTask(id),
    'tasks:subtasks': (parentId) => service.subtasksOf(parentId),
    'tasks:create': (input) => changed('tasks', service.createTask(input)),
    'tasks:update': (id, patch) => changed('tasks', service.updateTask(id, patch)),
    'tasks:complete': (id) => changed('tasks', service.completeTask(id)),
    'tasks:reopen': (id) => changed('tasks', service.reopenTask(id)),
    'tasks:delete': (id) => changed('tasks', service.deleteTask(id)),
    'projects:list': () => service.listProjects(),
    'projects:create': (name, color) => changed('projects', service.createProject(name, color)),
    'projects:rename': (id, name) => changed('projects', service.renameProject(id, name)),
    'projects:delete': (id) => changed('projects', service.deleteProject(id)),
    'tags:list': () => service.listTags(),
  }
}
