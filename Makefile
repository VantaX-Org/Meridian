# Developer shortcuts. CI runs the same commands from .github/workflows (see tests/COVERAGE_CI_SNIPPET.yml).

PYTEST ?= python -m pytest
COV = --cov=api --cov=workers --cov=checks --cov=sap --cov-report=xml --cov-report=term

.PHONY: coverage coverage-shard

# Whole-suite line coverage of api, workers, checks and sap, then the floor (tests/coverage_floor.py).
coverage:
	$(PYTEST) tests/ -q $(COV)
	python tests/coverage_floor.py coverage.xml

# One shard, as CI splits the suite: make coverage-shard SHARD=1/6
coverage-shard:
	PYTEST_SHARD=$(SHARD) $(PYTEST) tests/ -q $(COV)
	python tests/coverage_floor.py coverage.xml
