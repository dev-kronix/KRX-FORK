import prompts from 'prompts';
import removeInstallScripts from './scripts/remove-install-scripts';
import removePostgreSql from './scripts/remove-postgresql';
import removeMongoDb from './scripts/remove-mongodb';
import removeRelationalResourceGeneration from './scripts/resource-generation-scripts/remove-relational';
import removeDocumentResourceGeneration from './scripts/resource-generation-scripts/remove-document';
import removeAllDbResourceGeneration from './scripts/resource-generation-scripts/remove-all-db';
import removeAllDbPropertyGeneration from './scripts/property-generation-scripts/remove-all-db';
import removeDocumentPropertyGeneration from './scripts/property-generation-scripts/remove-document';
import removeRelationalPropertyGeneration from './scripts/property-generation-scripts/remove-relational';

void (async () => {
  const response = await prompts(
    [
      {
        type: 'select',
        name: 'database',
        message: 'Which database do you want to use?',
        choices: [
          { title: 'PostgreSQL and MongoDB', value: 'pg-mongo' },
          { title: 'PostgreSQL', value: 'pg' },
          { title: 'MongoDB', value: 'mongo' },
        ],
      },
    ],
    {
      onCancel() {
        process.exit(1);
      },
    },
  );

  if (response.database === 'pg-mongo') {
    removeRelationalResourceGeneration();
    removeDocumentResourceGeneration();
    removeDocumentPropertyGeneration();
    removeRelationalPropertyGeneration();
  }

  if (response.database === 'mongo') {
    removePostgreSql();
    removeRelationalResourceGeneration();
    removeRelationalPropertyGeneration();
    removeAllDbResourceGeneration();
    removeAllDbPropertyGeneration();
  }

  if (response.database === 'pg') {
    removeMongoDb();
    removeDocumentResourceGeneration();
    removeDocumentPropertyGeneration();
    removeAllDbResourceGeneration();
    removeAllDbPropertyGeneration();
  }

  removeInstallScripts();
  process.exit(0);
})();
