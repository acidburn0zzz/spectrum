// @flow
// Turn a callback-based listener into an async iterator
// Based on https://github.com/apollographql/graphql-subscriptions/blob/master/src/event-emitter-to-async-iterator.ts
const debug = require('debug')('iris:utils:asyncify');
import { $$asyncIterator } from 'iterall';
import Raven from 'shared/raven';

import type { GraphQLContext } from '../';
import type { GraphQLResolveInfo } from 'graphql';
import type { Cursor } from 'rethinkdbdash';

type Listener = ((arg: any) => void) => Promise<Cursor>;

const asyncify = (listener: Listener, onError?: Error => void) => (
  _: any,
  __: any,
  { user }: GraphQLContext,
  info: GraphQLResolveInfo
) => {
  try {
    debug(
      user ? `@${user.username || user.id}` : 'anonymous',
      'listening to',
      info.fieldName
    );
    const pullQueue = [];
    const pushQueue = [];
    let listening = true;
    let cursor;
    // Start listener
    listener(value => pushValue(value)).then(c => {
      cursor = c;
    });

    function pushValue(value) {
      if (pullQueue.length !== 0) {
        pullQueue.shift()({ value, done: false });
      } else {
        pushQueue.push(value);
      }
    }

    function pullValue() {
      return new Promise(resolve => {
        if (pushQueue.length !== 0) {
          resolve({ value: pushQueue.shift(), done: false });
        } else {
          pullQueue.push(resolve);
        }
      });
    }

    function emptyQueue() {
      if (listening) {
        listening = false;
        pullQueue.forEach(resolve => resolve({ value: undefined, done: true }));
        pullQueue.length = 0;
        pushQueue.length = 0;
        if (cursor) cursor.close();
      }
    }

    return ({
      next() {
        return listening ? pullValue() : this.return();
      },
      return() {
        emptyQueue();
        return Promise.resolve({ value: undefined, done: true });
      },
      throw(error) {
        emptyQueue();
        onError && onError(error);
        return Promise.reject(error);
      },
      [$$asyncIterator]() {
        return this;
      },
    }: any);
  } catch (err) {
    debug(err);
    onError && onError(err);
  }
};

export default asyncify;
