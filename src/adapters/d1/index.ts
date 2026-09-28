import { D1ConversationRepository } from './conversation-repository.ts';
import { D1CustomerRepository } from './customer-repository.ts';
import { D1EmployeeRepository } from './employee-repository.ts';
import { D1IgAccountRepository } from './ig-account-repository.ts';
import { D1MessageRepository } from './message-repository.ts';

export interface Repositories {
  igAccounts: D1IgAccountRepository;
  employees: D1EmployeeRepository;
  customers: D1CustomerRepository;
  conversations: D1ConversationRepository;
  messages: D1MessageRepository;
}

/** Fábrica única de repositorios sobre un binding D1. */
export function createRepositories(db: D1Database): Repositories {
  return {
    igAccounts: new D1IgAccountRepository(db),
    employees: new D1EmployeeRepository(db),
    customers: new D1CustomerRepository(db),
    conversations: new D1ConversationRepository(db),
    messages: new D1MessageRepository(db),
  };
}
